# Development Workflow

Follow the document dependency chain established in this documentation set:

```
Business Context -> AS-IS/TO-BE -> Business Requirements -> Domain Model ->
SAP Study/Mapping -> Architecture -> Data Model -> API -> UI -> Implementation
-> Testing -> Deployment -> Operations
```

Do not start a module's implementation before its entry in `03-domain/` and
`04-processes/` exists and has been reviewed — this is the concrete
practice that prevents repeating the original mistake (building UI before
the business model was understood).
