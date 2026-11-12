#!/usr/bin/env bash
# Sets up the off-site store for backups in Azure (ADR-037,
# afrinov-docs/docs/12-operations/backup-and-recovery.md), and writes the
# rclone credentials the backup service reads. Run once, by an Admin, on a
# Linux machine with the Azure CLI, signed in (az login) to the Microsoft
# account Afrinov already uses for Microsoft 365.
#
# What it makes:
#   - a storage account in South Africa North (Johannesburg), geo-redundant to
#     South Africa West (Cape Town), Cool tier, HTTPS only, no public access;
#   - a container whose every file is locked against change or deletion for
#     30 days (version-level immutability), so neither a mistake nor someone
#     holding the server's credentials can delete recent backups;
#   - rules that remove daily/ copies after 31 days and monthly/ after 366;
#   - an access key for the backup service that can add, read and list, but
#     not delete, valid for a year (renew it with this script's last step).
#
# Usage, from apps/backend:
#   bash backup/azure-setup.sh                                   set everything up
#   ACCOUNT=<name> RG=<group> bash backup/azure-setup.sh renew   a new year of access
# Settings (all optional for setup): RG, LOCATION, ACCOUNT, CONTAINER, RETAIN_DAYS, SAS_EXPIRY, OUT.
set -euo pipefail

mode="${1:-setup}"
[[ "$mode" = setup || "$mode" = renew ]] || { echo "usage: azure-setup.sh [renew]" >&2; exit 2; }
[[ "$mode" = setup || -n "${ACCOUNT:-}" ]] || { echo "renew needs ACCOUNT (and RG if not rg-afrinov-backups): the storage account made at setup" >&2; exit 2; }

RG="${RG:-rg-afrinov-backups}"
LOCATION="${LOCATION:-southafricanorth}"
ACCOUNT="${ACCOUNT:-afrinovbk$(openssl rand -hex 3)}"
CONTAINER="${CONTAINER:-afrinov-backups}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
SAS_EXPIRY="${SAS_EXPIRY:-$(date -u -d '+1 year' +%Y-%m-%dT%H:%MZ)}"
OUT="${OUT:-secrets/rclone.conf}"

say() { printf '\n== %s\n' "$*"; }

command -v az >/dev/null || { echo "Install the Azure CLI first: https://learn.microsoft.com/cli/azure/install-azure-cli" >&2; exit 1; }
az account show --query name -o tsv >/dev/null 2>&1 || { echo "Sign in first: az login" >&2; exit 1; }
[[ "$ACCOUNT" =~ ^[a-z0-9]{3,24}$ ]] || { echo "ACCOUNT must be 3 to 24 lowercase letters and digits" >&2; exit 1; }

if [[ "$mode" = setup ]]; then
say "Resource group $RG in $LOCATION"
az group create --name "$RG" --location "$LOCATION" --output none

say "Storage account $ACCOUNT (geo-redundant within South Africa, Cool tier)"
az storage account create --name "$ACCOUNT" --resource-group "$RG" --location "$LOCATION" \
  --sku Standard_GRS --kind StorageV2 --access-tier Cool \
  --min-tls-version TLS1_2 --https-only true --allow-blob-public-access false --output none
# Version-level immutability needs blob versioning.
az storage account blob-service-properties update --account-name "$ACCOUNT" --resource-group "$RG" \
  --enable-versioning true --output none

say "Container $CONTAINER, every file locked for $RETAIN_DAYS days"
az storage container-rm create --storage-account "$ACCOUNT" --resource-group "$RG" --name "$CONTAINER" \
  --enable-vlw true --output none
az storage container immutability-policy create --account-name "$ACCOUNT" --resource-group "$RG" \
  --container-name "$CONTAINER" --period "$RETAIN_DAYS" --output none

say "Keep daily copies 31 days and monthly copies 366 days"
policy=$(mktemp)
trap 'rm -f "$policy"' EXIT
cat > "$policy" <<JSON
{
  "rules": [
    {
      "enabled": true, "name": "afrinov-daily", "type": "Lifecycle",
      "definition": {
        "filters": { "blobTypes": ["blockBlob"], "prefixMatch": ["$CONTAINER/daily/"] },
        "actions": {
          "baseBlob": { "delete": { "daysAfterCreationGreaterThan": 31 } },
          "version": { "delete": { "daysAfterCreationGreaterThan": 31 } }
        }
      }
    },
    {
      "enabled": true, "name": "afrinov-monthly", "type": "Lifecycle",
      "definition": {
        "filters": { "blobTypes": ["blockBlob"], "prefixMatch": ["$CONTAINER/monthly/"] },
        "actions": {
          "baseBlob": { "delete": { "daysAfterCreationGreaterThan": 366 } },
          "version": { "delete": { "daysAfterCreationGreaterThan": 366 } }
        }
      }
    }
  ]
}
JSON
az storage account management-policy create --account-name "$ACCOUNT" --resource-group "$RG" \
  --policy "@$policy" --output none
fi

say "Access for the backup service: add, read and list, no delete, until $SAS_EXPIRY"
key=$(az storage account keys list --account-name "$ACCOUNT" --resource-group "$RG" --query '[0].value' -o tsv)
# A stored policy, so the access can be withdrawn at once by deleting the policy.
verb=create
[[ "$mode" = renew ]] && verb=update
az storage container policy "$verb" --container-name "$CONTAINER" --name backup-writer \
  --permissions racwl --expiry "$SAS_EXPIRY" --account-name "$ACCOUNT" --account-key "$key" --output none
sas=$(az storage container generate-sas --name "$CONTAINER" --policy-name backup-writer --https-only \
  --account-name "$ACCOUNT" --account-key "$key" -o tsv)
unset key

mkdir -p "$(dirname "$OUT")"
( umask 077 && cat > "$OUT" <<CONF
# Off-site store for backups (ADR-037), written by backup/azure-setup.sh.
# Can add, read and list in $CONTAINER, not delete. Expires $SAS_EXPIRY.
[offsite]
type = azureblob
sas_url = https://$ACCOUNT.blob.core.windows.net/$CONTAINER?$sas
CONF
)
unset sas

say "Done"
cat <<NEXT
Wrote $OUT. Next, on the server, from apps/backend:

  1. Let the backup service read it:   sudo chown 70 $OUT && sudo chmod 400 $OUT
  2. Set BACKUP_REMOTE=offsite:$CONTAINER in the environment Compose reads.
  3. docker compose up -d backup && docker compose run --rm backup now
  4. docker compose run --rm --entrypoint /opt/afrinov-backup/restore.sh backup latest --drill

After a week of good backups, lock the $RETAIN_DAYS-day rule so nobody, Admins
included, can shorten or remove it. This can't be undone:

  etag=\$(az storage container immutability-policy show --account-name $ACCOUNT \\
    --resource-group $RG --container-name $CONTAINER --query etag -o tsv)
  az storage container immutability-policy lock --account-name $ACCOUNT \\
    --resource-group $RG --container-name $CONTAINER --if-match "\$etag"

Before $SAS_EXPIRY, renew the access, or the Dashboard will show backups
failing to copy off site:

  ACCOUNT=$ACCOUNT RG=$RG bash backup/azure-setup.sh renew

Keep the account name ($ACCOUNT) with the backup key in the password manager.
NEXT
