targetScope = 'subscription'

@description('Azure region for the resource group and all resources.')
param location string

@description('Resource group name.')
param resourceGroupName string = 'amsterdam-750'

@description('Shared suffix used to derive resource names.')
param resourceSuffix string = ''

// Role definition names are deterministic GUIDs scoped to this subscription,
// matching the var expressions in main.bicep so role assignments resolve correctly.
var publicKeyReadRoleDefinitionName = guid(subscription().id, 'amsterdam750-public-key-read-role')
var adminKeyDecryptRoleDefinitionName = guid(subscription().id, 'amsterdam750-admin-key-decrypt-role')

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: resourceGroupName
  location: location
  tags: {
    project: 'amsterdam-750'
    managedBy: 'bicep'
    resourceSuffix: resourceSuffix
  }
}

module customRoles 'modules/custom-role-definitions.bicep' = {
  name: 'customRoleDefinitions-${uniqueString(subscription().id, resourceGroupName, location)}'
  params: {
    publicKeyReadRoleDefinitionName: publicKeyReadRoleDefinitionName
    adminKeyDecryptRoleDefinitionName: adminKeyDecryptRoleDefinitionName
  }
}

output resourceGroupName string = rg.name
output publicKeyReadRoleDefinitionId string = customRoles.outputs.publicKeyReadRoleDefinitionId
output adminKeyDecryptRoleDefinitionId string = customRoles.outputs.adminKeyDecryptRoleDefinitionId
