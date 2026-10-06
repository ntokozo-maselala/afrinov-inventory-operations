# Business Transaction Catalogue

## Procurement
- Create supplier
- Update supplier
- Create purchase order
- Submit purchase order
- Approve purchase order
- Cancel purchase order

## Inventory
- Create material
- Update material (name, threshold, unit of measure)
- Deactivate material
- Create/merge location
- Receive stock (Goods Receipt, PO-linked or ad hoc)
- Issue stock (to employee, optional project reference)
- Transfer stock (location to location)
- Adjust stock (reason required: count variance, damage, scrap, other)
- Check out tool (to employee, optional project)
- Check in tool

## Reporting
- Generate current-stock report (by category/location)
- Generate movement-history report (by material/date range/type)
- Generate stock-value report
- Generate project-consumption report
- Generate low-stock/reorder report

## Identity & Access
- Create user
- Assign role
- Deactivate user

Each of these maps 1:1 to an API operation (`08-api/resource-model.md`) and
should map 1:1 to at least one acceptance test scenario
(`11-testing/acceptance-testing.md`).
