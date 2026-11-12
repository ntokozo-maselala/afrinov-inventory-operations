# The backup service (ADR-037, 12-operations/backup-and-recovery.md): pg_dump
# and pg_restore from the same PostgreSQL major as the database, gpg to
# encrypt, rclone to copy off site to whichever store is chosen.
FROM postgres:16-alpine

RUN apk add --no-cache gnupg rclone tzdata

COPY lib.sh backup.sh restore.sh run.sh /opt/afrinov-backup/
RUN chmod 0755 /opt/afrinov-backup/*.sh \
  && mkdir -p /backups /home/backup \
  && chown postgres:postgres /backups /home/backup

# gpg and rclone keep their state under HOME; nothing here needs root.
ENV TZ=Africa/Johannesburg HOME=/home/backup BACKUP_DIR=/backups
USER postgres
WORKDIR /home/backup
ENTRYPOINT ["/opt/afrinov-backup/run.sh"]
