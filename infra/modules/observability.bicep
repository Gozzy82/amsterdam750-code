targetScope = 'resourceGroup'

@description('Azure region for the shared workbook.')
param location string

@description('Deployment environment used in resource names.')
param deploymentEnvironment string

@description('Resource ID of the public Application Insights component.')
param publicAppInsightsResourceId string

@description('Resource ID of the admin Application Insights component.')
param adminAppInsightsResourceId string

@description('Email address that receives Azure Monitor alerts.')
@minLength(3)
param alertEmailAddress string

@description('Tags applied to observability resources.')
param tags object = {}

var actionGroupName = 'amsterdam750-${deploymentEnvironment}-alerts'
var workbookDisplayName = 'Amsterdam 750 - ${deploymentEnvironment} observability'
var workbookData = replace(
  replace(
    loadTextContent('../workbooks/observability.json'),
    '__PUBLIC_APP_INSIGHTS_RESOURCE_ID__',
    publicAppInsightsResourceId
  ),
  '__ADMIN_APP_INSIGHTS_RESOURCE_ID__',
  adminAppInsightsResourceId
)
var monitoredComponents = [
  {
    name: 'public'
    resourceId: publicAppInsightsResourceId
  }
  {
    name: 'admin'
    resourceId: adminAppInsightsResourceId
  }
]

resource alertActionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: actionGroupName
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'am750-alert'
    enabled: true
    emailReceivers: [
      {
        name: 'Amsterdam 750 beheerder'
        emailAddress: alertEmailAddress
        useCommonAlertSchema: true
      }
    ]
  }
}

resource failedRequestAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for component in monitoredComponents: {
    name: 'amsterdam750-${deploymentEnvironment}-${component.name}-failed-requests'
    location: 'global'
    tags: tags
    properties: {
      description: 'Waarschuw wanneer de ${component.name} Function App mislukte requests registreert.'
      severity: 1
      enabled: true
      autoMitigate: true
      scopes: [
        component.resourceId
      ]
      evaluationFrequency: 'PT1M'
      windowSize: 'PT5M'
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            name: 'FailedRequests'
            metricName: 'requests/failed'
            operator: 'GreaterThan'
            threshold: 0
            timeAggregation: 'Count'
            criterionType: 'StaticThresholdCriterion'
          }
        ]
      }
      actions: [
        {
          actionGroupId: alertActionGroup.id
        }
      ]
    }
  }
]

resource slowResponseAlerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [
  for component in monitoredComponents: {
    name: 'amsterdam750-${deploymentEnvironment}-${component.name}-slow-response'
    location: 'global'
    tags: tags
    properties: {
      description: 'Waarschuw wanneer de gemiddelde ${component.name} responstijd langer dan twee seconden is.'
      severity: 2
      enabled: true
      autoMitigate: true
      scopes: [
        component.resourceId
      ]
      evaluationFrequency: 'PT5M'
      windowSize: 'PT15M'
      criteria: {
        'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
        allOf: [
          {
            name: 'SlowResponse'
            metricName: 'requests/duration'
            operator: 'GreaterThan'
            threshold: 2000
            timeAggregation: 'Average'
            criterionType: 'StaticThresholdCriterion'
          }
        ]
      }
      actions: [
        {
          actionGroupId: alertActionGroup.id
        }
      ]
    }
  }
]

resource observabilityWorkbook 'Microsoft.Insights/workbooks@2022-04-01' = {
  name: guid(resourceGroup().id, 'Microsoft.Insights/workbooks', workbookDisplayName)
  location: location
  tags: tags
  kind: 'shared'
  properties: {
    category: 'workbook'
    description: 'Productionoverzicht voor requests, fouten, responstijden en exceptions van Amsterdam 750.'
    displayName: workbookDisplayName
    serializedData: workbookData
    sourceId: 'Azure Monitor'
    version: '1.0'
  }
}

output actionGroupResourceId string = alertActionGroup.id
output workbookResourceId string = observabilityWorkbook.id
