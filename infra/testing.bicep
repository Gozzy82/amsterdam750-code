targetScope = 'resourceGroup'

// ─── PARAMETERS ───────────────────────────────────────────────────────────────

@description('Deployment location for all resources.')
param location string = resourceGroup().location

@description('Production storage account name (shared with testing).')
@minLength(3)
@maxLength(24)
param storageAccountName string

@description('Public testing Function App name.')
param functionPublicName string = 'amsterdam750-function-testing'

@description('Admin testing Function App name.')
param functionAdminName string = 'amsterdam750-function-admin-testing'

@description('Key Vault name (shared with production, must already exist).')
param keyVaultName string = 'amsterdam750kv1'

@description('App Service plan name for the public testing Function App.')
param appServicePlanPublicName string = 'asp-amsterdam750-public-testing'

@description('App Service plan name for the admin testing Function App.')
param appServicePlanAdminName string = 'asp-amsterdam750-admin-testing'

@description('Application Insights name for public testing Function App.')
param appInsightsPublicName string = 'amsterdam750-func-testing'

@description('Application Insights name for admin testing Function App.')
param appInsightsAdminName string = 'amsterdam750-function-admin-testing'

@description('Key name used for PII envelope encryption in Key Vault.')
param kekKeyName string = 'kek-prereg'

@description('Secret name in Key Vault for Azure Communication Services connection string.')
param communicationsSecretName string = 'communications-connection-string'

@description('Secret name in Key Vault for Twilio account SID.')
param twilioAccountSidSecretName string = 'TWILIO-ACCOUNT-SID'

@description('Secret name in Key Vault for Twilio auth token.')
param twilioAuthTokenSecretName string = 'TWILIO-AUTH-TOKEN'

@description('Secret name in Key Vault for Twilio sender phone number.')
param twilioFromNumberSecretName string = 'TWILIO-FROM-NUMBER'

@description('Secret name in Key Vault for the shared data storage connection string (same as production).')
param tableConnectionStringSecretName string = 'TABLE-CONNECTION-STRING'

@description('Secret name in Key Vault for the admin Easy Auth client secret.')
param microsoftProviderAuthenticationSecretName string = 'MICROSOFT-PROVIDER-AUTHENTICATION-SECRET'

@description('Cloudflare Turnstile site key for testing. Defaults to the always-pass Cloudflare test key.')
param turnstileSiteKey string = '1x00000000000000000000AA'

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

@description('Disable the admin timer-based send-invites job. Recommended true for testing.')
param sendInvitesDisabled bool = true

@description('Allowed Entra tenant IDs for Easy Auth on the admin testing Function App.')
param websiteAuthAadAllowedTenants string = subscription().tenantId

@description('Application (client) ID for the admin Easy Auth Entra app registration.')
@minLength(1)
param microsoftProviderAuthenticationClientId string

@description('OpenID issuer URL for the admin Easy Auth Entra app registration.')
param microsoftProviderAuthenticationIssuer string = 'https://login.microsoftonline.com/${subscription().tenantId}/v2.0'

// ─── VARIABLES ────────────────────────────────────────────────────────────────

var tags = {
  project: 'amsterdam-750'
  environment: 'testing'
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
var tableConnectionStringSecretUri = '${keyVault.properties.vaultUri}secrets/${tableConnectionStringSecretName}'
var twilioAccountSidSecretUri = '${keyVault.properties.vaultUri}secrets/${twilioAccountSidSecretName}'
var twilioAuthTokenSecretUri = '${keyVault.properties.vaultUri}secrets/${twilioAuthTokenSecretName}'
var twilioFromNumberSecretUri = '${keyVault.properties.vaultUri}secrets/${twilioFromNumberSecretName}'
var microsoftProviderAuthenticationSecretUri = '${keyVault.properties.vaultUri}secrets/${microsoftProviderAuthenticationSecretName}'

// ─── EXISTING SHARED RESOURCES ────────────────────────────────────────────────

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource kekKey 'Microsoft.KeyVault/vaults/keys@2023-07-01' existing = {
  name: kekKeyName
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

resource tableConnectionStringSecretScope 'Microsoft.KeyVault/vaults/secrets@2023-07-01' existing = {
  name: tableConnectionStringSecretName
  parent: keyVault
}

// ─── EXISTING PRODUCTION STORAGE ACCOUNT (shared with testing) ────────────────

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' existing = {
  name: 'default'
  parent: storageAccount
}

resource preregistrationsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  name: preregistrationsTableName
  parent: tableService
}

resource statsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  name: statsTableName
  parent: tableService
}

resource rateLimitsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  name: rateLimitsTableName
  parent: tableService
}

resource otpTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  name: otpTableName
  parent: tableService
}

resource phoneLockTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' existing = {
  name: phoneLockTableName
  parent: tableService
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' existing = {
  name: 'default'
  parent: storageAccount
}

resource inviteJobsQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' existing = {
  name: queueName
  parent: queueService
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' existing = {
  name: 'default'
  parent: storageAccount
}

resource functionPublicDeploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: 'deployment-public-testing'
  parent: blobService
  properties: {
    publicAccess: 'None'
  }
}

resource functionAdminDeploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: 'deployment-admin-testing'
  parent: blobService
  properties: {
    publicAccess: 'None'
  }
}

// ─── APPLICATION INSIGHTS ─────────────────────────────────────────────────────

resource publicAppInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsPublicName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
  }
}

resource adminAppInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsAdminName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
  }
}

// ─── APP SERVICE PLANS ────────────────────────────────────────────────────────

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

// ─── FUNCTION APPS ────────────────────────────────────────────────────────────

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

// ─── APP SETTINGS ─────────────────────────────────────────────────────────────

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
    TWILIO_ACCOUNT_SID: '@Microsoft.KeyVault(SecretUri=${twilioAccountSidSecretUri})'
    TWILIO_AUTH_TOKEN: '@Microsoft.KeyVault(SecretUri=${twilioAuthTokenSecretUri})'
    TWILIO_FROM_NUMBER: '@Microsoft.KeyVault(SecretUri=${twilioFromNumberSecretUri})'
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

// ─── EASY AUTH (ADMIN) ────────────────────────────────────────────────────────

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

// ─── ROLE ASSIGNMENTS: STORAGE TABLE DATA CONTRIBUTOR ─────────────────────────

resource publicPreregistrationsTableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
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

// ─── ROLE ASSIGNMENTS: STORAGE QUEUE DATA CONTRIBUTOR ─────────────────────────

resource adminInviteJobsQueueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(inviteJobsQueue.id, functionAdmin.id, storageQueueDataContributorRoleId)
  scope: inviteJobsQueue
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: storageQueueDataContributorRoleId
  }
}

// ─── ROLE ASSIGNMENTS: KEY VAULT SECRETS USER ─────────────────────────────────

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

resource publicTableConnectionStringSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(tableConnectionStringSecretScope.id, functionPublic.id, keyVaultSecretsUserRoleId)
  scope: tableConnectionStringSecretScope
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

resource adminTableConnectionStringSecretRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(tableConnectionStringSecretScope.id, functionAdmin.id, keyVaultSecretsUserRoleId)
  scope: tableConnectionStringSecretScope
  properties: {
    principalId: functionAdmin.identity.principalId
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

// ─── ROLE ASSIGNMENTS: CUSTOM KEY VAULT KEY ROLES ─────────────────────────────

resource publicKeyVaultKeyReadRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kekKey.id, functionPublic.id, publicKeyReadRoleDefinitionId)
  scope: kekKey
  properties: {
    principalId: functionPublic.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: publicKeyReadRoleDefinitionId
  }
}

resource adminKeyVaultKeyDecryptRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kekKey.id, functionAdmin.id, adminKeyDecryptRoleDefinitionId)
  scope: kekKey
  properties: {
    principalId: functionAdmin.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: adminKeyDecryptRoleDefinitionId
  }
}

// ─── OUTPUTS ──────────────────────────────────────────────────────────────────

output storageAccountName string = storageAccount.name
output functionPublicHostName string = functionPublic.properties.defaultHostName
output functionAdminHostName string = functionAdmin.properties.defaultHostName
