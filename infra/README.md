# infra

Deze map bevat de volledige IaC-definitie voor het Amsterdam-750 platform in `main.bicep`.

## Wat wordt geprovisioned

- Storage account (Table + Queue) inclusief:
  - `PreRegistrations`
  - `Stats`
  - `PreregistrationRatelimits`
  - `OtpCodes`
  - `invite-jobs` queue
- Key Vault in RBAC-modus
  - RSA key voor PII envelope-encryptie (`kek-prereg`)
  - Secrets voor Turnstile, Twilio, ACS connection string en admin Easy Auth
- 2 Function Apps (public/admin), elk met eigen system-assigned managed identity
- 2 App Service plans (FC1 Flex Consumption)
- 2 Application Insights instances
- Gedeeld Azure Monitor workbook voor requests, fouten, responstijden en exceptions
- E-mail-action group en 4 production metric alerts:
  - failed requests voor public/admin
  - hoge gemiddelde responstijd voor public/admin
- Static Web App resource
- RBAC role assignments:
  - `Storage Table Data Contributor` op storage account voor beide Function Apps
  - `Key Vault Crypto User` op Key Vault voor beide Function Apps
  - `Key Vault Secrets User` op Key Vault voor beide Function Apps

## Belangrijkste parameters

Defaults zijn afgestemd op de huidige resource-namen uit `stappenplan.md`, maar kunnen worden overschreven:

- `storageAccountName` (default `amsterdam750`)
- `keyVaultName` (default `amsterdam750keyvault1`)
- `functionPublicName` (default `amsterdam750-function`)
- `functionAdminName` (default `amsterdam750-function-admin`)
- `staticWebAppName` (default `amsterdam750-web`)
- `microsoftProviderAuthenticationClientId` (admin Easy Auth app registration)
- `microsoftProviderAuthenticationIssuer` (default `https://login.microsoftonline.com/<tenant-id>/v2.0`)
- `alertEmailAddress` (activeert het workbook, de action group en eigen alerts)

Secret-waarden kunnen als secure parameters meegegeven worden:

- `turnstileSecret`
- `twilioAccountSid`
- `twilioAuthToken`
- `twilioFromNumber`
- `communicationsConnectionString`
- `microsoftProviderAuthenticationClientId`
- `microsoftProviderAuthenticationSecret`

Niet-geheime Turnstile configuratie:

- `turnstileSiteKey` — publieke Cloudflare Turnstile sitekey voor de public Function App configuratie

## Deploy

Eerste deployment of secret-rotatie:

```powershell
az deployment group create `
  --resource-group amsterdam-750 `
  --template-file infra/main.bicep `
  --parameters deploymentEnvironment=prod `
               turnstileSiteKey="<sitekey>" `
               turnstileSecret="<secret>" `
               twilioAccountSid="<sid>" `
               twilioAuthToken="<token>" `
               twilioFromNumber="<number>" `
               alertEmailAddress="<alert-email>" `
               microsoftProviderAuthenticationClientId="<easy-auth-client-id>" `
               communicationsConnectionString="<acs-connection-string>" `
               microsoftProviderAuthenticationSecret="<easy-auth-secret>"
```

Alleen admin Easy Auth toevoegen of bijwerken:

```powershell
az deployment group create `
  --resource-group amsterdam-750 `
  --template-file infra/main.bicep `
  --parameters deploymentEnvironment=prod `
               microsoftProviderAuthenticationClientId="<easy-auth-client-id>" `
               microsoftProviderAuthenticationSecret="<easy-auth-secret>"
```

Redeploy zonder secrets te overschrijven:

```powershell
az deployment group create `
  --resource-group amsterdam-750 `
  --template-file infra/main.bicep `
  --parameters deploymentEnvironment=prod `
               microsoftProviderAuthenticationClientId="<easy-auth-client-id>" `
               alertEmailAddress="<alert-email>"
```

De Function Apps verwijzen nu naar versionless Key Vault secret-URI's. Daardoor blijft een redeploy idempotent: als je geen secret-waarden meestuurt, blijven bestaande Key Vault secrets intact.

Voor `Invoke-IaCDeploy.ps1` kan het alertadres via
`-AlertEmailAddress` of de environment variable
`AZURE_ALERT_EMAIL_ADDRESS` worden meegegeven. Zonder alertadres laat een
incremental redeploy bestaande observability-resources intact, maar maakt een
nieuwe omgeving ze niet aan.

De template zet daarnaast ook de ontbrekende niet-geheime app settings uit productie terug, waaronder:

- `RL_EMAIL_LIMIT`
- `RL_WINDOW_SECONDS`
- `SEND_INVITES_DISABLED`
- `WEBSITE_AUTH_AAD_ALLOWED_TENANTS`
- `DEPLOYMENT_STORAGE_CONNECTION_STRING` (afgeleid van de gedeployde storage account)
- `TURNSTILE_SITEKEY`

## Turnstile configuratie

De preregistratie-endpoint valideert Turnstile nu op **iedere** submit. Daarvoor zijn twee waarden nodig:

- `turnstileSiteKey` — publieke sitekey, gebruikt in de public Function App settings
- `turnstileSecret` — secret, opgeslagen in Key Vault en als Key Vault reference aangeboden aan `functions-public`

Belangrijk: de browser leest de sitekey niet uit de Function App, maar uit `apps/web/public/config.js`. De Static Web App deploy-workflow moet daarom óók `TURNSTILE_SITEKEY` als GitHub variable krijgen zodat `window.APP_CONFIG.turnstileSitekey` wordt gegenereerd.

Kort samengevat:

- **Bicep / Azure**: `turnstileSecret` (+ optioneel `turnstileSiteKey` als app setting op de Function App)
- **GitHub Actions variable**: `TURNSTILE_SITEKEY`
- **GitHub Actions secret voor de static web app is niet nodig** voor Turnstile; alleen de sitekey is publiek

Voor de admin Function App zet de template nu ook `authsettingsV2` (Easy Auth) neer zodra `microsoftProviderAuthenticationClientId` is ingevuld. De configuratie forceert authenticatie en geeft ongeauthenticeerde requests een `401`, passend bij het huidige gedrag van de admin endpoints.

## Deploy script (PowerShell)

Je kunt dezelfde redeploy ook draaien via het `Invoke-IaCDeploy.ps1` script. Dit script vereist dat je de subscription ID expliciet meegeeft — dit voorkomt onbedoelde deployments naar de verkeerde Azure-omgeving.

Na een succesvolle deployment controleert het script ook expliciet of de vereiste Table-resources (`PreRegistrations`, `Stats`, `PreregistrationRatelimits`, `OtpCodes`, `PhoneLocks`, of de doorgegeven overrides) echt bestaan in de gedeployde storage account.

**De subscription ID doorgeven:**

Optie 1: Via environment variabele

```powershell
$env:AZURE_SUBSCRIPTION_ID = "<subscription-id>"
.\infra\Invoke-IaCDeploy.ps1
```

Optie 2: Via parameter

```powershell
.\infra\Invoke-IaCDeploy.ps1 -SubscriptionId "<subscription-id>"
```

Als je geen subscription ID meegeeft, krijg je een foutmelding.

Als de environment variables hieronder gezet zijn, werkt het script ook voor secret-rotatie; als ze ontbreken, doet het script een redeploy zonder de bestaande Key Vault secrets aan te passen.

## What-if script (PowerShell)

Je kunt dezelfde parameter-logica ook voor een dry-run gebruiken via:

```powershell
.\infra\Invoke-IaCWhatIf.ps1
```

**De subscription ID doorgeven:**

Optie 1: Via environment variabele

```powershell
$env:AZURE_SUBSCRIPTION_ID = "<subscription-id>"
.\infra\Invoke-IaCWhatIf.ps1
```

Optie 2: Via parameter

```powershell
.\infra\Invoke-IaCWhatIf.ps1 -SubscriptionId "<subscription-id>"
```

De scripts lezen secrets uit environment variables. De Easy Auth client ID is verplicht, zodat de deployment niet per ongeluk een onbeveiligde admin-app oplevert. Secret-waarden zijn alleen nodig bij de eerste deployment of rotatie; zonder deze waarden blijven bestaande Key Vault secrets intact:

- `AZURE_SUBSCRIPTION_ID` (of via `-SubscriptionId` parameter)
- `TURNSTILE_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `ACS_CONNECTION_STRING`
- `MICROSOFT_PROVIDER_AUTHENTICATION_CLIENT_ID`
- `MICROSOFT_PROVIDER_AUTHENTICATION_ISSUER_URL`
- `MICROSOFT_PROVIDER_AUTHENTICATION_SECRET`

Voorbeeld:

```powershell
$env:AZURE_SUBSCRIPTION_ID = "<subscription-id>"
$env:TURNSTILE_SECRET = "<secret>"
$env:TWILIO_ACCOUNT_SID = "<sid>"
$env:TWILIO_AUTH_TOKEN = "<token>"
$env:TWILIO_FROM_NUMBER = "<number>"
$env:ACS_CONNECTION_STRING = "<acs-connection-string>"
$env:MICROSOFT_PROVIDER_AUTHENTICATION_CLIENT_ID = "<easy-auth-client-id>"
$env:MICROSOFT_PROVIDER_AUTHENTICATION_ISSUER_URL = "https://login.microsoftonline.com/<tenant-id>/v2.0"
$env:MICROSOFT_PROVIDER_AUTHENTICATION_SECRET = "<easy-auth-secret>"

.\infra\Invoke-IaCDeploy.ps1 -DeploymentEnvironment prod
.\infra\Invoke-IaCWhatIf.ps1 -DeploymentEnvironment prod
```

De productie-deployment en daaropvolgende driftcontrole zijn vastgelegd in
`production-drift-2026-08-05.json`. De hercontrole detecteerde geen concrete
Create-, Modify- of Delete-drift.

## Opmerking

Deze template definieert infrastructuur. App-code deployment blijft via de bestaande GitHub Actions workflows lopen.

## Redeploy runbook

Voor een volledige teardown + fresh redeploy:

1. `.\scripts\bootstrap\Invoke-Teardown.ps1`
2. `.\scripts\bootstrap\Invoke-Bootstrap.ps1`
3. `.\infra\Invoke-IaCDeploy.ps1`
4. `.\scripts\bootstrap\Set-StaticWebAppToken.ps1`
5. `.\infra\Invoke-TestingDeploy.ps1`
6. Trigger de GitHub workflows voor Static Web App, `functions-public` en `functions-admin`

Actuele testing-URL in deze sessie:

- `https://white-plant-08d5dd80f.7.azurestaticapps.net/preregister/`

Belangrijk:

- `green-field...` URLs zijn stale.
- Key Vault heet `amsterdam750kv`.
- De resource-namen volgen de gegenereerde suffix.
- Blijft **Versturen** grijs na laden, check Turnstile/CSP/sitekey; tijdens versturen is kort grijs normaal.
