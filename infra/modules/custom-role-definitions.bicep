targetScope = 'subscription'

@description('Resource name for the public key read custom role definition.')
param publicKeyReadRoleDefinitionName string

@description('Resource name for the admin key decrypt custom role definition.')
param adminKeyDecryptRoleDefinitionName string

resource publicKeyReadRoleDefinition 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: publicKeyReadRoleDefinitionName
  properties: {
    roleName: 'Amsterdam750 Public Key Reader'
    description: 'Read-only access to specific Key Vault keys for local public-key encryption.'
    type: 'CustomRole'
    permissions: [
      {
        actions: []
        notActions: []
        dataActions: [
          'Microsoft.KeyVault/vaults/keys/read'
        ]
        notDataActions: []
      }
    ]
    assignableScopes: [
      subscription().id
    ]
  }
}

resource adminKeyDecryptRoleDefinition 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: adminKeyDecryptRoleDefinitionName
  properties: {
    roleName: 'Amsterdam750 Admin Key Decrypt Reader'
    description: 'Read and decrypt access to specific Key Vault keys for admin-only PII decryption.'
    type: 'CustomRole'
    permissions: [
      {
        actions: []
        notActions: []
        dataActions: [
          'Microsoft.KeyVault/vaults/keys/read'
          'Microsoft.KeyVault/vaults/keys/decrypt/action'
        ]
        notDataActions: []
      }
    ]
    assignableScopes: [
      subscription().id
    ]
  }
}

output publicKeyReadRoleDefinitionId string = publicKeyReadRoleDefinition.id
output adminKeyDecryptRoleDefinitionId string = adminKeyDecryptRoleDefinition.id
