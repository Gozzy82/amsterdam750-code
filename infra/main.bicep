targetScope = 'resourceGroup'

@description('Deployment location for all resources.')
param location string = resourceGroup().location

@description('Location for the Static Web App. Must be one of the supported SWA regions.')
@allowed(['centralus', 'eastus2', 'westus2', 'westeurope', 'eastasia'])
param staticWebAppLocation string = 'eastus2'

@description('Deployment environment tag.')
@allowed([
  'dev'
  'test'
  'prod'
])
param deploymentEnvironment string = 'prod'

@description('Storage account name (3-24 lowercase letters and numbers).')
@minLength(3)
@maxLength(24)
param storageAccountName string = 'amsterdam750'

@description('Public Function App name.')
param functionPublicName string = 'amsterdam750-function'

@description('Admin Function App name.')
param functionAdminName string = 'amsterdam750-function-admin'

@description('Static Web App name.')
param staticWebAppName string = 'amsterdam750-web'

@description('Key Vault name.')
param keyVaultName string = 'amsterdam750kv'

@description('App Service plan name for the public Function App.')
param appServicePlanPublicName string = 'asp-amsterdam750-public'

@description('App Service plan name for the admin Function App.')
param appServicePlanAdminName string = 'asp-amsterdam750-admin'

@description('Application Insights name for public Function App telemetry.')
param appInsightsPublicName string = 'amsterdam750-func'

@description('Application Insights name for admin Function App telemetry.')
param appInsightsAdminName string = 'amsterdam750-function-admin'

@description('Key name used for PII envelope encryption in Key Vault.')
param kekKeyName string = 'kek-prereg'

@description('Secret name in Key Vault for Azure Communication Services connection string.')
param communicationsSecretName string = 'communications-connection-string'

@description('Secret name in Key Vault for Cloudflare Turnstile secret.')
param turnstileSecretName string = 'TURNSTILE-SECRET'

@description('Secret name in Key Vault for Twilio account SID.')
param twilioAccountSidSecretName string = 'TWILIO-ACCOUNT-SID'

@description('Secret name in Key Vault for Twilio auth token.')
param twilioAuthTokenSecretName string = 'TWILIO-AUTH-TOKEN'

@description('Secret name in Key Vault for Twilio sender phone number.')
param twilioFromNumberSecretName string = 'TWILIO-FROM-NUMBER'

@description('Cloudflare Turnstile site key (public). This must also be exposed to the browser during Static Web App deployment.')
param turnstileSiteKey string = ''

@description('Sender email configured in Azure Communication Services.')
param emailFrom string = 'DoNotReply@example.azurecomm.net'

@description('Invite URL base used by admin invite worker.')
param inviteBaseUrl string = 'https://example.com/register/?token='

@description('Queue name for invite jobs.')
param queueName string = 'invite-jobs'

@description('Primary preregistration table name.')
param preregistrationsTableName string = 'PreRegistrations'

@description('Statistics table name.')
param statsTableName string = 'Stats'

@description('Rate-limit table name.')
param rateLimitsTableName string = 'PreregistrationRatelimits'

@description('OTP table name.')
param otpTableName string = 'OtpCodes'

@description('Phone uniqueness lock table name.')
param phoneLockTableName string = 'PhoneLocks'

@description('Maximum preregistrations per email within the rate-limit window.')
param rateLimitEmailLimit int = 10

@description('Rate-limit window in seconds.')
param rateLimitWindowSeconds int = 3600

@description('Disable the admin timer-based send-invites job.')
param sendInvitesDisabled bool = false

@description('Allowed Entra tenant IDs for Easy Auth on the admin Function App.')
param websiteAuthAadAllowedTenants string = subscription().tenantId

@description('Application (client) ID for the admin Easy Auth Entra app registration.')
@minLength(1)
param microsoftProviderAuthenticationClientId string

@description('OpenID issuer URL for the admin Easy Auth Entra app registration.')
param microsoftProviderAuthenticationIssuer string = 'https://login.microsoftonline.com/${subscription().tenantId}/v2.0'

@description('Secret name in Key Vault for the admin Easy Auth client secret.')
param microsoftProviderAuthenticationSecretName string = 'MICROSOFT-PROVIDER-AUTHENTICATION-SECRET'

@description('Secret name in Key Vault for the data storage connection string.')
param tableConnectionStringSecretName string = 'TABLE-CONNECTION-STRING'

@description('Resource ID of the Log Analytics workspace for Key Vault diagnostics.')
param logAnalyticsWorkspaceResourceId string = ''

@description('Email address for production Azure Monitor alerts. Observability resources are created when this value is provided.')
param alertEmailAddress string = ''

@description('Cloudflare Turnstile secret value. Stored in Key Vault and referenced by the public Function App.')
@secure()
param turnstileSecret string = ''

@description('Twilio Account SID value.')
@secure()
param twilioAccountSid string = ''

@description('Twilio auth token value.')
@secure()
param twilioAuthToken string = ''

@description('Twilio sender phone number value.')
@secure()
param twilioFromNumber string = ''

@description('Azure Communication Services connection string value.')
@secure()
param communicationsConnectionString string = ''

@description('Easy Auth client secret for the admin Function App.')
@secure()
param microsoftProviderAuthenticationSecret string = ''

var tags = {
  project: 'amsterdam-750'
  environment: deploymentEnvironment
  managedBy: 'bicep'
}

var storageTableDataContributorRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
)
var storageQueueDataContributorRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
)
var keyVaultSecretsUserRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var publicKeyReadRoleDefinitionName = guid(subscription().id, 'amsterdam750-public-key-read-role')
var adminKeyDecryptRoleDefinitionName = guid(subscription().id, 'amsterdam750-admin-key-decrypt-role')
var publicKeyReadRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  publicKeyReadRoleDefinitionName
)
var adminKeyDecryptRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  adminKeyDecryptRoleDefinitionName
)
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
var tableAccountUrl = 'https://${storageAccount.name}.table.${environment().suffixes.storage}'
var queueAccountUrl = 'https://${storageAccount.name}.queue.${environment().suffixes.storage}'
var turnstileSecretUri = '${keyVault.properties.vaultUri}secrets/${turnstileSecretName}'
var twilioAccountSidSecretUri = '${keyVault.properties.vaultUri}secrets/${twilioAccountSidSecretName}'
var twilioAuthTokenSecretUri = '${keyVault.properties.vaultUri}secrets/${twilioAuthTokenSecretName}'
var twilioFromNumberSecretUri = '${keyVault.properties.vaultUri}secrets/${twilioFromNumberSecretName}'
var microsoftProviderAuthenticationSecretUri = '${keyVault.properties.vaultUri}secrets/${microsoftProviderAuthenticationSecretName}'
var tableConnectionStringSecretUri = '${keyVault.properties.vaultUri}secrets/${tableConnectionStringSecretName}'

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  name: 'default'
  parent: storageAccount
}

resource preregistrationsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  name: preregistrationsTableName
  parent: tableService
}

resource statsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  name: statsTableName
  parent: tableService
}

resource rateLimitsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  name: rateLimitsTableName
  parent: tableService
}

resource otpTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  name: otpTableName
  parent: tableService
}

resource phoneLockTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  name: phoneLockTableName
  parent: tableService
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  name: 'default'
  parent: storageAccount
}

resource inviteJobsQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  name: queueName
  parent: queueService
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  name: 'default'
  parent: storageAccount
}

resource functionPublicDeploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: 'deployment-public'
  parent: blobService
  properties: {
    publicAccess: 'None'
  }
}

resource functionAdminDeploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: 'deployment-admin'
  parent: blobService
  properties: {
    publicAccess: 'None'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource kekKey 'Microsoft.KeyVault/vaults/keys@2023-07-01' = {
  name: kekKeyName
  parent: keyVault
  properties: {
    kty: 'RSA'
    keySize: 2048
    keyOps: [
      'wrapKey'
      'unwrapKey'
      'encrypt'
      'decrypt'
      'sign'
      'verify'
    ]
  }
}

resource turnstileSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(turnstileSecret)) {
  name: turnstileSecretName
  parent: keyVault
  properties: {
    value: turnstileSecret
  }
}

resource twilioAccountSidSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(twilioAccountSid)) {
  name: twilioAccountSidSecretName
  parent: keyVault
  properties: {
    value: twilioAccountSid
  }
}

resource twilioAuthTokenSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(twilioAuthToken)) {
  name: twilioAuthTokenSecretName
  parent: keyVault
  properties: {
    value: twilioAuthToken
  }
}

resource twilioFromNumberSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(twilioFromNumber)) {
  name: twilioFromNumberSecretName
  parent: keyVault
  properties: {
    value: twilioFromNumber
  }
}

resource communicationsSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(communicationsConnectionString)) {
  name: communicationsSecretName
  parent: keyVault
  properties: {
    value: communicationsConnectionString
  }
}

resource microsoftProviderAuthenticationSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(microsoftProviderAuthenticationSecret)) {
  name: microsoftProviderAuthenticationSecretName
  parent: keyVault
  properties: {
    value: microsoftProviderAuthenticationSecret
  }
}

resource tableConnectionStringSecretResource 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  name: tableConnectionStringSecretName
  parent: keyVault
  properties: {
    value: storageConnectionString
  }
}

resource turnstileSecretScope 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  name: turnstileSecretName
  parent: keyVault
}

resource twilioAccountSidSecretScope 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  name: twilioAccountSidSecretName
  parent: keyVault
}

resource twilioAuthTokenSecretScope 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  name: twilioAuthTokenSecretName
  parent: keyVault
}

resource twilioFromNumberSecretScope 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  name: twilioFromNumberSecretName
  parent: keyVault
}

resource communicationsSecretScope 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  name: communicationsSecretName
  parent: keyVault
}

resource microsoftProviderAuthenticationSecretScope 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  name: microsoftProviderAuthenticationSecretName
  parent: keyVault
}

module customRoleDefinitions 'modules/custom-role-definitions.bicep' = {
  name: 'custom-role-definitions-${uniqueString(subscription().id, resourceGroup().name, location)}'
  scope: subscription()
  params: {
    publicKeyReadRoleDefinitionName: publicKeyReadRoleDefinitionName
    adminKeyDecryptRoleDefinitionName: adminKeyDecryptRoleDefinitionName
  }
}

resource publicAppInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsPublicName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    RetentionInDays: 90
  }
}

resource adminAppInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsAdminName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    RetentionInDays: 90
  }
}

resource appServicePlanPublic 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanPublicName
  location: location
  tags: tags
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  kind: 'functionapp'
  properties: {
    reserved: true
  }
}

resource appServicePlanAdmin 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanAdminName
  location: location
  tags: tags
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  kind: 'functionapp'
  properties: {
    reserved: true
  }
}

resource functionPublic 'Microsoft.Web/sites@2023-12-01' = {
  name: functionPublicName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlanPublic.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: {
        allowedOrigins: [
          'https://${staticWebApp.properties.defaultHostname}'
        ]
        supportCredentials: false
      }
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageAccount.properties.primaryEndpoints.blob}${functionPublicDeploymentContainer.name}'
          authentication: {
            type: 'StorageAccountConnectionString'
            storageAccountConnectionStringName: 'DEPLOYMENT_STORAGE_CONNECTION_STRING'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 100
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }
}

resource functionPublicAppSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  name: 'appsettings'
  parent: functionPublic
  properties: {
    AzureWebJobsStorage: storageConnectionString
    DEPLOYMENT_STORAGE_CONNECTION_STRING: storageConnectionString
    APPINSIGHTS_CONNECTION_STRING: publicAppInsights.properties.ConnectionString
    APPLICATIONINSIGHTS_CONNECTION_STRING: publicAppInsights.properties.ConnectionString
    TABLE_CONNECTION_STRING: '@Microsoft.KeyVault(SecretUri=${tableConnectionStringSecretUri})'
    TABLE_NAME: preregistrationsTableName
    RATE_TABLE_NAME: rateLimitsTableName
    STATS_TABLE_NAME: statsTableName
    OTP_TABLE_NAME: otpTableName
    PHONE_LOCK_TABLE_NAME: phoneLockTableName
    RL_EMAIL_LIMIT: '${rateLimitEmailLimit}'
    RL_WINDOW_SECONDS: '${rateLimitWindowSeconds}'
    KV_URL: keyVault.properties.vaultUri
    KEK_KEY_NAME: kekKeyName
    TURNSTILE_SITEKEY: turnstileSiteKey
    TURNSTILE_SECRET: '@Microsoft.KeyVault(SecretUri=${turnstileSecretUri})'
    TWILIO_ACCOUNT_SID: '@Microsoft.KeyVault(SecretUri=${twilioAccountSidSecretUri})'
    TWILIO_AUTH_TOKEN: '@Microsoft.KeyVault(SecretUri=${twilioAuthTokenSecretUri})'
    TWILIO_FROM_NUMBER: '@Microsoft.KeyVault(SecretUri=${twilioFromNumberSecretUri})'
  }
}

resource functionAdmin 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAdminName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlanAdmin.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: {
        allowedOrigins: [
          'https://${staticWebApp.properties.defaultHostname}'
        ]
        supportCredentials: false
      }
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storageAccount.properties.primaryEndpoints.blob}${functionAdminDeploymentContainer.name}'
          authentication: {
            type: 'StorageAccountConnectionString'
            storageAccountConnectionStringName: 'DEPLOYMENT_STORAGE_CONNECTION_STRING'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 100
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '22'
      }
    }
  }
}

resource functionAdminAppSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  name: 'appsettings'
  parent: functionAdmin
  properties: {
    AzureWebJobsStorage: storageConnectionString
    DEPLOYMENT_STORAGE_CONNECTION_STRING: storageConnectionString
    APPINSIGHTS_CONNECTION_STRING: adminAppInsights.properties.ConnectionString
    APPLICATIONINSIGHTS_CONNECTION_STRING: adminAppInsights.properties.ConnectionString
    TABLE_CONNECTION_STRING: '@Microsoft.KeyVault(SecretUri=${tableConnectionStringSecretUri})'
    TABLE_NAME: preregistrationsTableName
    STATS_TABLE_NAME: statsTableName
    QUEUE_NAME: queueName
    TABLE_ACCOUNT_URL: tableAccountUrl
    QUEUE_ACCOUNT_URL: queueAccountUrl
    PHONE_LOCK_TABLE_NAME: phoneLockTableName
    KV_URL: keyVault.properties.vaultUri
    KEK_KEY_NAME: kekKeyName
    COMMUNICATIONS_SECRET_NAME: communicationsSecretName
    EMAIL_FROM: emailFrom
    INVITE_BASE_URL: inviteBaseUrl
    SEND_INVITES_DISABLED: sendInvitesDisabled ? 'true' : 'false'
    WEBSITE_AUTH_AAD_ALLOWED_TENANTS: websiteAuthAadAllowedTenants
    MICROSOFT_PROVIDER_AUTHENTICATION_SECRET: '@Microsoft.KeyVault(SecretUri=${microsoftProviderAuthenticationSecretUri})'
  }
}

resource functionAdminAuthSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  name: 'authsettingsV2'
  parent: functionAdmin
  properties: {
    platform: {
      enabled: true
    }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'Return401'
    }
    httpSettings: {
      requireHttps: true
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        isAutoProvisioned: false
        registration: {
          clientId: microsoftProviderAuthenticationClientId
          clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
          openIdIssuer: microsoftProviderAuthenticationIssuer
        }
      }
    }
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  tags: tags
  sku: {
    tier: 'Free'
    name: 'Free'
  }
  properties: {}
}

resource publicStorageTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(preregistrationsTable.id, functionPublic.id, storageTableDataContributorRoleId)
  scope: preregistrationsTable
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource publicRateLimitsTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(rateLimitsTable.id, functionPublic.id, storageTableDataContributorRoleId)
  scope: rateLimitsTable
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource publicStatsTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(statsTable.id, functionPublic.id, storageTableDataContributorRoleId)
  scope: statsTable
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource publicOtpTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(otpTable.id, functionPublic.id, storageTableDataContributorRoleId)
  scope: otpTable
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource publicPhoneLockTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(phoneLockTable.id, functionPublic.id, storageTableDataContributorRoleId)
  scope: phoneLockTable
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource adminPreregistrationsTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(preregistrationsTable.id, functionAdmin.id, storageTableDataContributorRoleId)
  scope: preregistrationsTable
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource adminStatsTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(statsTable.id, functionAdmin.id, storageTableDataContributorRoleId)
  scope: statsTable
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource adminPhoneLockTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(phoneLockTable.id, functionAdmin.id, storageTableDataContributorRoleId)
  scope: phoneLockTable
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageTableDataContributorRoleId
  }
}

resource adminInviteJobsQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(inviteJobsQueue.id, functionAdmin.id, storageQueueDataContributorRoleId)
  scope: inviteJobsQueue
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataContributorRoleId
  }
}

resource publicKeyVaultKeyReadRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kekKey.id, functionPublic.id, publicKeyReadRoleDefinitionId)
  scope: kekKey
  dependsOn: [
    customRoleDefinitions
  ]
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: publicKeyReadRoleDefinitionId
  }
}

resource adminKeyVaultKeyDecryptRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kekKey.id, functionAdmin.id, adminKeyDecryptRoleDefinitionId)
  scope: kekKey
  dependsOn: [
    customRoleDefinitions
  ]
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: adminKeyDecryptRoleDefinitionId
  }
}

resource publicKeyVaultSecretsVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionPublic.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource adminKeyVaultSecretsVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionAdmin.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource publicTurnstileSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(turnstileSecretScope.id, functionPublic.id, keyVaultSecretsUserRoleId)
  scope: turnstileSecretScope
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource publicTwilioAccountSidSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(twilioAccountSidSecretScope.id, functionPublic.id, keyVaultSecretsUserRoleId)
  scope: twilioAccountSidSecretScope
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource publicTwilioAuthTokenSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(twilioAuthTokenSecretScope.id, functionPublic.id, keyVaultSecretsUserRoleId)
  scope: twilioAuthTokenSecretScope
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource publicTwilioFromNumberSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(twilioFromNumberSecretScope.id, functionPublic.id, keyVaultSecretsUserRoleId)
  scope: twilioFromNumberSecretScope
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource adminCommunicationsSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(communicationsSecretScope.id, functionAdmin.id, keyVaultSecretsUserRoleId)
  scope: communicationsSecretScope
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource adminMicrosoftProviderAuthenticationSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(microsoftProviderAuthenticationSecretScope.id, functionAdmin.id, keyVaultSecretsUserRoleId)
  scope: microsoftProviderAuthenticationSecretScope
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource publicTableConnectionStringSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(tableConnectionStringSecretResource.id, functionPublic.id, keyVaultSecretsUserRoleId)
  scope: tableConnectionStringSecretResource
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

resource adminTableConnectionStringSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(tableConnectionStringSecretResource.id, functionAdmin.id, keyVaultSecretsUserRoleId)
  scope: tableConnectionStringSecretResource
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRoleId
  }
}

module observability 'modules/observability.bicep' = if (!empty(alertEmailAddress)) {
  name: 'observability-${deploymentEnvironment}'
  params: {
    location: location
    deploymentEnvironment: deploymentEnvironment
    publicAppInsightsResourceId: publicAppInsights.id
    adminAppInsightsResourceId: adminAppInsights.id
    alertEmailAddress: alertEmailAddress
    tags: tags
  }
}

resource keyVaultDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (!empty(logAnalyticsWorkspaceResourceId)) {
  name: 'kv-diagnostics-to-law'
  scope: keyVault
  properties: {
    workspaceId: logAnalyticsWorkspaceResourceId
    logs: [
      {
        category: 'AuditEvent'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}

output storageAccountResourceId string = storageAccount.id
output keyVaultResourceId string = keyVault.id
output keyVaultUri string = keyVault.properties.vaultUri
output keyVaultKeyIdentifier string = kekKey.properties.keyUriWithVersion
output functionPublicHostName string = functionPublic.properties.defaultHostName
output functionAdminHostName string = functionAdmin.properties.defaultHostName
output staticWebAppHostName string = staticWebApp.properties.defaultHostname
