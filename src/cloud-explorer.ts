import * as vscode from 'vscode';
import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';
import { JSONPath } from 'jsonpath-plus';

import { displayMenu } from './extension';

import { extensionContext } from './extension';
import vm_sizes from './vm_sizes.json' assert {type: 'json'};

var view: helpers.GenericWebView|null = null;

export function displayCloudExplorer(extensionContext : vscode.ExtensionContext) {

  // do not display more than one Cloud Explorer panel
  if (view !== null && !view.destroyed) {
    view.focus();
    return;
  }

  let formDefinition = {
    type: 'layout-tree-with-details',
    id: 'layout'
    };

  view = new helpers.GenericWebView(extensionContext, "Cloud Commander", "Cloud Commander");

  view.setVariable("vm_sizes", vm_sizes);

  view.MsgHandler = function (msg: any) {
    switch (msg.command) {
      case 'ready':
        var loader = new helpers.DefinitionLoader(extensionContext.extensionPath, "defs/____tree.yaml");
        var resources = loader.getYaml();
        view.updateTreeViewItems(resources, null);
        return;

      case 'refresh':
        // XXX - need to send refresh event to explorer
        if ('id' in msg) {
          CloudExplorerRefresh(msg['id']);
        } else {
          CloudExplorerRefresh(view.treeGetCurrentId());
        }
        return;
      case 'selected':

        // XXX - this should be optimized
        // don't requery subitems if already there
        var item = view.treeFindItem(this.treeGetItems(), msg.id);
        if (!('subitems' in item) || item['subitems'].length === 0) {
          view.treeQueryItems(view, msg.id);
        }

        // a tree item was selected, display details accordingly
        // or try to query items accordingly
        createDetailsView(view, msg.id);

        return;
      case 'action-clicked':
        if (msg.id === 'action-refresh') {
          RefreshCurrentContext();
        } else if (msg.id === 'action-add') {
          displayCreateResourceMenu(view.treeGetCurrentId());
        }
        return;
      case 'button-clicked':

        if (msg.id === 'install_button') {
          view.runStepsInstallation();
        }
        return;
  
     default:
        console.log('XXX');
    }
  };

  view.createPanel(formDefinition, "media/icon.webp");
}

function validateCondition(resource: any, op: any) {
  if ('when' in op) {
    var p = op['when']['path'];
    var requiredValue = op['when']['value'];
    var actualValue = JSONPath({path: p, json: resource['raw']})[0];
    var compare = (("compare" in op['when']) ? op['when']['compare'] : "eq"); 

    if (compare === "eq") {
      return (requiredValue === actualValue);
    } else if (compare === "ne") {
      return (requiredValue !== actualValue);
    }
  }
  return true;
}

function getFormattedValue(resource: any, id: string): string {
  if (id in resource) {
    return resource[id];
  } else {
    return "-";
  }
}

function createDetailsView(view: any, id: string) {
  var resource = view.treeFindItem(view.treeGetItems(), id);

  if (resource) {
    var hasSource: boolean = ('source' in resource);
    var hasQueryDetails: boolean = ('query-details' in resource);

    if ('details' in resource) {
      //
      // if details definition is specified, just use it
      //

      var loader = new helpers.DefinitionLoader(extensionContext.extensionPath, "defs/" + resource['details']);
      let yml = loader.getYaml();
      view.updateTreeViewDetails(yml);
    } else if ('raw' in resource && Object.keys(resource['raw']).length !== 0) {
      //
      // If there's raw resource, we can also check if there are any operations that
      // could be executed on that resource. If so, append appropriate actions.
      //
      var loader = new helpers.DefinitionLoader(extensionContext.extensionPath, "defs/empty.yaml");
      let yml = loader.getYaml();

      let sections: any[] = [];
      let basicInformationItems: any[] = [];
      let operationItems: any[] = [];
      yml['form'] = sections;


      // first matching templates
      var templates: any[] = view.treeFindMatchingDetailsTemplates(resource['type']);

      for (var templateIdx = 0; templateIdx < templates.length; templateIdx++) {

        var definition: any = view.createDefinitionFromTemplate(templates[templateIdx]['definition'], resource);

        sections.push(definition);
      }

        //if ('name' in resource || 'state' in resource || 'location' in resource) {
        //  var icon = 'icon-square-orange.png';
        //  if (resource['state'] === 'started') {
        //    icon = 'icon-square-green.png';
        //  } else if (resource['state'] === 'stopped') {
        //    icon = 'icon-square-red.png';
        //  }
        //}

      //
      // get all the operations here
      //
      var operations = findOperations(id);

      if (operations.length > 0) {
        sections.push(
          {
            type: 'section',
            title: 'Operations',
            subitems: operationItems
          }  
        );

        for (var idx in operations) {
          var op = operations[idx];

          // check if there's condition and validate
          if (!validateCondition(resource, op)) {
            continue;
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
                var parent = view.treeFindParent({ subitems: view.treeGetItems()}, id);
                row['refresh'] = parent['id'];
              } else if (op['refresh'] === 'self') {
                row['refresh'] = id;
              }
            }
            operationItems.push(row);
          }
        }
      }

      var raw = JSON.stringify(resource['raw'], null, 2);
      sections.push(
            {
              type: 'section',
              title: 'Raw Info',
              subitems: [
                {
                  type: 'code-block',
                  content: raw
                }
    
              ]
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

    if (resource['id'].startsWith('cloud-') ||
        resource['id'] === 'welcome' ||
        (resource['raw'] && resource['raw']['type'] && resource['raw']['type'] === 'Microsoft.Resources/resourceGroups' )) {
      setActionsMsg['data'].push(
      {
        codicon: 'codicon-add',
        description: 'Create Resource',
        action: 'action-add'
      });
    }

    if (hasSource || hasQueryDetails) {
      setActionsMsg['data'].push(
      {
        codicon: 'codicon-refresh',
        description: 'Refresh',
        action: 'action-refresh'
      });
    }

    view.postMessage(setActionsMsg);
  }else {
    view.updateTreeViewDetails({});
  }
}

function findOperations(item_id: string): any[] {
  var operations: any[] = [];
  var item = view.treeFindItem(view.treeGetItems(), item_id);

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
      if ('template' in operation) {
        var template = "";
        var parameters = {};
        if (typeof operation['template'] === 'string') {
          template = operation['template'];
        } else if ('name' in operation['template']) {
          template = operation['template']['name'];
          if ('parameters' in operation['template']) {
            parameters = operation['template']['parameters'];
          }
        }

        if (template !== "") {
          menu_items.push({
            location: template + ".yaml",
            name: operation['name'],
            parameters: parameters
          });
        }
      }
    }
  }

  displayMenu(menu_items);
}

function RefreshCurrentContext() {
  view.treeQueryItems(view, view.treeGetCurrentId());

  // a tree item was selected, display details accordingly
  // or try to query items accordingly
  createDetailsView(view, view.treeGetCurrentId());
}

export function CloudExplorerRefresh(refresh_id: string) {

  var id = (refresh_id !== "" ? refresh_id : view.treeGetCurrentId());
  view.treeQueryItems(view, id);

  // a tree item was selected, display details accordingly
  // or try to query items accordingly
  createDetailsView(view, id);
}
