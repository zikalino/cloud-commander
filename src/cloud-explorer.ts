import * as vscode from 'vscode';
import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';
import { JSONPath } from 'jsonpath-plus';

import { displayMenu } from './extension';

import { extensionContext } from './extension';

var currentCloudId = "";
var currentResourceId  = "";
var resources: any[] = []; 
var view: helpers.GenericWebView|null = null;

export function displayCloudExplorer(extensionContext : vscode.ExtensionContext) {


  let formDefinition = {
    type: 'layout-tree-with-details',
    id: 'layout'
    };

  view = new helpers.GenericWebView(extensionContext, "Cloud Commander", "Cloud Commander");

  view.MsgHandler = function (msg: any) {
    switch (msg.command) {
      case 'ready':
        //view.postMessage(populateMsg);
        let yml = loadYaml(extensionContext.extensionPath + "/defs/welcome.yaml");

        queryAllResources();
        view.updateTreeViewItems(resources, null);
        view.updateTreeViewDetails(yml);
        return;
      case 'refresh':
        // XXX - need to send refresh event to explorer
        if ('id' in msg) {
          CloudExplorerRefresh(msg['id']);
        } else {
          CloudExplorerRefresh(currentResourceId);
        }
        return;
      case 'selected':
        // a tree item was selected, display details accordingly
        // or try to query items accordingly
        createDetailsView(view, msg.id);

        // XXX - this should be optimized
        // don't requery subitems if already there
        var item = findItem(resources, msg.id);
        if (!('subitems' in item) || item['subitems'].length === 0) {
          tryToQueryItems(view, msg.id);
        }
        return;
      case 'action-clicked':
        if (msg.id === 'action-refresh') {
          RefreshCurrentContext();
        } else if (msg.id === 'action-add') {
          displayCreateResourceMenu(currentResourceId);
        }
        return;
     default:
        console.log('XXX');
    }
  };

  view.createPanel(formDefinition, "media/icon.webp");
}

import { loadYaml } from "./extension";

async function tryToQueryItems(view: any, id: string) {

  var resource = setContext(id);

  if ('query-details' in resource) {
    view.postMessage({ command: 'set-item-state', id: id, state: 'loading'});
    var data = genericQuery(resource['query-details']);
    resource['raw'] = data;

    if ('extract-details' in resource) {
      var extract = resource['extract-details'];
      for (var extractIdx = 0; extractIdx < extract.length; extractIdx++) {
        var field = extract[extractIdx]['field'];
        var path = extract[extractIdx]['path'];
        var value = JSONPath({path: path, json: data})[0];
        if ('map' in extract[extractIdx]) {
          value = extract[extractIdx]['map'][value];
        }
        resource[field] = value;
      }
    }

    // update details
    createDetailsView(view, id);
    view.postMessage({ command: 'set-item-state', id: id, state: 'loaded'});
  }

  if ('query' in resource) {

    view.postMessage({ command: 'set-item-state', id: id, state: 'loading'});

    var data = genericQuery(resource['query']);
    var items: any[] = [];
    var ids: string[] = JSONPath({path: resource['path-id'], json: data});
    var names: string[] = JSONPath({path: resource['path-name'], json: data});
    var raw: any[] = JSONPath({path: resource['path-raw'], json: data});

    for (var idx in ids) {
      var item: any = {
        "name": names[idx],
        "id": ids[idx].toString(),
        "icon": resource['icon'],
        "subitems": [],
        "raw": raw[idx]
      };

      if ('child-template' in resource) {
        item['operations'] = [];
        for (var opIdx in resource['child-template']) {
          var operation = resource['child-template'][opIdx];
          var child_operation: any = {
            type: operation['type'],
            name: operation['name']
          };

          if ('refresh' in operation) {
            child_operation['refresh'] = operation['refresh'];
          }

          if ('cmd' in operation) {
            var cmd = operation['cmd'].replaceAll("${id}", ids[idx].toString());
            cmd = cmd.replaceAll("${name}", names[idx]);
            child_operation['cmd'] = cmd;
            child_operation['global'] = false;
          }

          if ('when' in operation) {
            child_operation['when'] = operation['when'];
          }
          if (operation['type'] === 'query-details') {
            var query = operation['query'].replaceAll("${id}", ids[idx].toString());
            query = query.replaceAll("${name}", names[idx]);
            item['query-details'] = query;
            if ('extract' in operation) {
              item['extract-details'] = operation['extract'];
            }
            // XXX - details mapping???
          } else if ('query' in operation) {
            var query = operation['query'].replaceAll("${id}", ids[idx].toString());
            query = query.replaceAll("${name}", names[idx]);
            item['query'] = query;
            item['path-id'] = operation['path-id'];
            item['path-name'] = operation['path-name'];
            item['path-raw'] = operation['path-raw'];
          } else {
            item['operations'].push(child_operation);
          }
        }
      }
      items.push(item);
    }

    // just sort items by label
    items.sort((a: any, b: any) => a['name'].localeCompare(b['name']));

    resource.subitems = items;
    view.updateTreeViewItems(items, id);
  }
}

function createDetailsView(view: any, id: string) {
  var resource = setContext(id);

  if (resource) {
    if ('details' in resource) {
      //
      // if details definition is specified, just use it
      //
      let yml = loadYaml(extensionContext.extensionPath + "/defs/" + resource['details']);
      view.updateTreeViewDetails(yml);
    } else if ('raw' in resource) {
      //
      // If there's raw resource, we can also check if there are any operations that
      // could be executed on that resource. If so, append appropriate actions.
      //
      let yml = loadYaml(extensionContext.extensionPath + "/defs/empty.yaml");
      yml['form'] = [
        {
          type: 'fieldset',
          subitems: []
        }
      ];

      //
      // Basic Information - whatever is available for this resource type
      //
      if ('id' in resource) {
        yml['form'][0]['subitems'].push(
          {
            type: 'text-block',
            width: 'wide',
            font: 'header-1',
            content: 'Basic Information'
          },
          {
            type: 'separator'
          }
        );

        if ('id' in resource) {
          yml['form'][0]['subitems'].push(
            {
              type: 'info-row',
              codicon: 'symbol-field',
              color: 'black',
              label: 'ID',
              value: resource['id']
            }
          );
        }

        if ('name' in resource) {
          yml['form'][0]['subitems'].push(
            {
              type: 'info-row',
              codicon: 'symbol-string',
              color: 'black',
              label: 'Name',
              value: resource['name']
            }
          );
        }
        if ('state' in resource) {
          yml['form'][0]['subitems'].push(
            {
              type: 'info-row',
              codicon: 'symbol-string',
              color: 'black',
              label: 'State',
              value: resource['state']
            }
          );
        }
        if ('location' in resource) {
          yml['form'][0]['subitems'].push(
            {
              type: 'info-row',
              codicon: 'location',
              color: 'black',
              label: 'Location',
              value: resource['location']
            }
          );
        }
        if ('size' in resource) {
          yml['form'][0]['subitems'].push(
            {
              type: 'info-row',
              codicon: 'location',
              color: 'black',
              label: 'Size',
              value: resource['size']
            }
          );
        }
      }

      //
      // get all the operations here
      //
      var operations = findOperations(id);

      if (operations.length > 0) {
        yml['form'][0]['subitems'].push(
          {
            type: 'text-block',
            width: 'wide',
            font: 'header-1',
            content: 'Operations'
          },
          {
            type: 'separator'
          }  
        );

        for (var idx in operations) {
          var op = operations[idx];

          // check condition
          if ('when' in op) {
            var p = op['when']['path'];
            var requiredValue = op['when']['value'];
            var actualValue = JSONPath({path: p, json: resource['raw']})[0];

            if (requiredValue !== actualValue) {
              continue;
            }
          }

          if (op['type'] !== 'create') {
            var cmd = op['cmd'].replace("${id}", id);
            var name = op['name'];
            var row: any = {
                type: 'action-row',
                name: name,
                install: cmd
              };
            // does anything need to be refreshed after operation is executed?
            if ('refresh' in op) {
              if (op['refresh'] === 'parent') {
                // we need to refresh list where this particular item is located
                var parent = findParent({ subitems: resources}, id);
                row['refresh'] = parent['id'];
              } else if (op['refresh'] === 'self') {
                row['refresh'] = id;
              }
            }
            yml['form'][0]['subitems'].push(row);
          }
        }
      }

      var raw = JSON.stringify(resource['raw'], null, 2);
      yml['form'][0]['subitems'].push(
            {
              type: 'text-block',
              width: 'wide',
              font: 'header-1',
              content: 'Raw Info'
            },
            {
              type: 'separator'
            },
            {
              type: 'code-block',
              content: raw
            }
          );


      view.updateTreeViewDetails(yml);
    } else {
      //
      // We have nothing to show here. Perhaps we could show some links or create icons?
      //
      view.updateTreeViewDetails({});
    }

    //
    // Here we are setting action icons that will appear in the header
    //
    let setActionsMsg: any = {
      command: 'actions',
      data: [
      ]
    };

    if (resource['id'].startsWith('cloud-') || (resource['raw']['type'] && resource['raw']['type'] === 'Microsoft.Resources/resourceGroups' )) {
      setActionsMsg['data'].push(
      {
        codicon: 'codicon-add',
        description: 'Create Resource',
        action: 'action-add'
      });

      if (resource['id'].startsWith('cloud-') || (resource['raw']['type'] && resource['raw']['type'] === 'Microsoft.Resources/resourceGroups') ) {
        setActionsMsg['data'].push(
        {
          codicon: 'codicon-refresh',
          description: 'Refresh',
          action: 'action-refresh'
        });
      }
    }

    view.postMessage(setActionsMsg);
  }else {
    view.updateTreeViewDetails({});
  }
}

function setContext(id: string): any {
  currentCloudId = "";
  currentResourceId = "";

  return setContextRecursive(id, resources);
}

function setContextRecursive(id: string, resources: any[]): any {
  for (var i = 0; i < resources.length; i++) {
    if (resources[i]['id'] === id) {
      if (id.startsWith("cloud-") && (currentCloudId === "")) {
        currentCloudId = id;
      }
      currentResourceId = id;
      return resources[i];
    }

    if (resources[i]['subitems']) {
      var found: any =  setContextRecursive(id, resources[i]['subitems']);
      if (found) {
        if (resources[i]['id'].startsWith('cloud-')) {
          currentCloudId = resources[i]['id'];
        }
        return found;
      }
    }
  }

  return null;
}

function queryAllResources() {
  resources = loadYaml(extensionContext.extensionPath + "/defs/____tree.yaml");
}

async function azQueryResources(): Promise<any> {

  console.log("Query Azure Resources");

  var response: any = [];
  var resourceGroups = azQueryResourceGroups();

  // first get all the resource groups

  for (var i = 0; i < resourceGroups.length; i++) {
    response.push({
      "name": resourceGroups[i]['name'],
      "id": resourceGroups[i]['name'],
      "subitems": [],
      "raw": resourceGroups[i]
      });
  }

  // query all the resources and append them to appropriate resource groups
  var resources = azQuerySubResources();

  for (var i = 0; i < resources.length; i++) {
    // find resource group to stick it into
    for (var j = 0; j < response.length; j++) {
      if (response[j]['name'] === resources[i]['resourceGroup']) {
        response[j]['subitems'].push({
          "name": resources[i]['name'],
          "id": resources[i]['name'],
          "raw": resources[i],
          "subitems": [{ name: "abc" + i, id: "cde" + i}, { name: "xyz" + i, id: "xyz" + i,
            subitems: [ {name: "qqq" + i, id: "rrr" + i} ]}
          ]
          });
      }
    }
  }

  return response;
}

function azQuerySubResources() {
  var r: string = "";
  var cmd = "az resource list";

  const cp = require('child_process');
  if (process.platform === "win32") {
    r = cp.execSync(cmd, { shell: 'powershell' }).toString();
  } else {
    r = cp.execSync(cmd, { shell: '/bin/bash' }).toString();
  }

  return JSON.parse(r);
}

function azQueryResourceGroups() {
  var r: string = "";
  var cmd = "az group list";

  const cp = require('child_process');
  if (process.platform === "win32") {
    r = cp.execSync(cmd, { shell: 'powershell' }).toString();
  } else {
    r = cp.execSync(cmd, { shell: '/bin/bash' }).toString();
  }

  return JSON.parse(r);
}


function genericQuery(cmd: string) {
  var r: string = "";

  const cp = require('child_process');
  if (process.platform === "win32") {
    r = cp.execSync(cmd, { shell: 'powershell' }).toString();
  } else {
    r = cp.execSync(cmd, { shell: '/bin/bash' }).toString();
  }

  return JSON.parse(r);
}

function findItem(subtree: any[], item_id: string): any {
  for (var idx in subtree) {
    var item = subtree[idx];
    if (item['id'] === item_id) {
      return item;
    }

    if ('subitems' in item) {
      var found = findItem(item['subitems'], item_id);

      if (found) {
        return  found;
      }
    }
  }

  return null;
}

function findParent(item: any, item_id: string): any {
  if ('subitems' in item) {

    for (var idx = 0; idx < item['subitems'].length; idx++) {
      var child: any = item['subitems'][idx];
      if (child['id'] === item_id) {
        return item;
      }

      var found = findParent(child, item_id);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function findOperations(item_id: string): any[] {
  var operations: any[] = [];
  var item = findItem(resources, item_id);

  if (item !== null) {
    findOperationsRecursive(item, operations, 0);
  }

  return operations;
}

function findOperationsRecursive(item: any, operations: any[], level: number) {

  if (item !== null) {
    // operations from this item
    if ('operations' in item) {
      for (var opIdx = 0; opIdx < item['operations'].length; opIdx++) {
        let operation = item['operations'][opIdx];
        let global = !('global' in operation) || operation['global'];
        if (level === 0 || global) {
          operations.push(operation);
        }
      }
    }

    // and all the matching operations from subitems
    if ('subitems' in item) {
      for (var idx in item['subitems']) {
        findOperationsRecursive(item['subitems'][idx], operations, level + 1);
      }
    }
  }
}


function displayCreateResourceMenu(item_id: string) {
  // XXX - find menu item
  var operations: any[] = findOperations(item_id);
  var menu_items: any[] = [];

  for (var idx in operations) {
    var operation = operations[idx];
    if (operation['type'] === 'create') {
      menu_items.push({
        location: operation['template'] + ".yaml",
        name: operation['name']
      });
    }
  }

  displayMenu(menu_items);
}

function RefreshCurrentContext() {

  // Use:
  // currentCloudId
  // currentResourceId
  tryToQueryItems(view, currentResourceId);
}

export function CloudExplorerRefresh(refresh_id: string) {
  tryToQueryItems(view, refresh_id !== "" ? refresh_id : currentResourceId);
}
