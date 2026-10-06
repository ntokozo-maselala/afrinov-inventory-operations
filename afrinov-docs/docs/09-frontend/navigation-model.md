# Navigation Model

Top-level nav = bounded contexts (Procurement, Inventory, Tools, Reports,
Administration), not arbitrary feature pages. Each section's landing page
is a list/table view; drill-in goes to detail; actions (issue, receive,
transfer, adjust, check-out) are modal or dedicated-screen flows launched
from context, not separate unrelated nav items — mirroring how a technician
actually thinks ("I need to issue material," not "I need to go to the
Inventory Items page and find an edit button").
