import * as vscode from 'vscode';
import YAML from 'yaml';
import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';

import { displayCloudExplorer, CloudExplorerRefresh } from './cloud-explorer';
import vm_sizes from './vm_sizes.json' assert {type: 'json'};

//import SwaggerParser from "@apidevtools/swagger-parser";
var extensionUri: vscode.Uri;
var mediaFolder: vscode.Uri;
export var extensionContext: vscode.ExtensionContext;

const fs = require("fs");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate (context: vscode.ExtensionContext) {
  extensionContext = context;
  extensionUri = context.extensionUri;

  mediaFolder = vscode.Uri.joinPath(extensionUri, 'media');

  let disposable = vscode.commands.registerCommand(
    'vscode-cloud.displayCloudExplorer',
    () => {
      //parseCommands();
      displayCloudExplorer(extensionContext);
    }
  );

  context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate () {}

export async function displayMenu(submenu: any) {
  var selected: string[] = [];
  for (var i in submenu) {
    selected.push(submenu[i].name);
  }

  const result = await vscode.window.showQuickPick(selected, {
    placeHolder: 'Select...'
  });

  for (var i in submenu) {
    if (submenu[i].name === result) {
      if ('submenu' in submenu[i]) {
        displayMenu(submenu[i].submenu);
      } else {
        // XXX - load yaml
        var parameters: any = ('parameters' in submenu[i]) ? submenu[i]['parameters'] : {};
        let yml = loadYaml(extensionContext.extensionPath + "/defs/" + submenu[i].location);
        loadYamlView(yml, (('refresh-id' in submenu[i]) ? submenu[i]['refresh-id'] : null), parameters);
      }
    }
  }
}

async function loadYamlView(yml: any, refresh_id: string|null, parameters: any = null) {

  var tabTitle: string = ('title' in yml) ? yml['title'] : "Raw CLI";

  let view = new helpers.GenericWebView(extensionContext, tabTitle, "Cloud Commmander"); 
  view.setVariable("vm_sizes", vm_sizes);

  if (parameters !== null) {
    for (var p in parameters) {
      view.setVariable(p, parameters[p]);
    }
  }

  view.createPanel(yml, "media/icon.webp");

  view.MsgHandler = function (msg: any) {
    if (msg.command === 'ready') {
      view.runStepsVerification();
    } else if (msg.command === 'refresh') {
      // XXX - need to send refresh event to explorer
      if ('id' in msg) {
        CloudExplorerRefresh(msg['id']);
      } else {
        CloudExplorerRefresh(refresh_id ? refresh_id : "");
      }
    } else if (msg.command === 'button-clicked') {
      //vscode.window.showInformationMessage('Button ' + msg.id + ' Clicked!');
      if (msg.id === 'close') {
        view.close();
      } else if (msg.id === 'install_button') {
        view.runStepsInstallation();
      }
    }
  };
}

// XXX - perhaps this should be moved to helpers
export function loadYaml(location: string) : any {
  // extensionContext.extensionPath + "/defs/" + result + ".yaml"
  let y = fs.readFileSync(location, "utf8");
  y = YAML.parse(y);
  loadIncludes(y);
  return y;
}

function loadIncludes(data: any) {

  if (typeof data === 'object') {
    if (Array.isArray(data)) {
      for (let i = data.length - 1; i >= 0; i--) {

        if ((data[i] !== null) && (typeof data[i] === 'object') && ('$include' in data[i])) {
          var prefix = undefined;
          if ('prefix' in data[i]) {
            prefix = data[i]['prefix'];
          }
          var showif = undefined;
          if ('show-if' in data[i]) {
            showif = data[i]['show-if'];
          }

          var included = loadYaml(extensionContext.extensionPath + "/defs/" + data[i]['$include']);

          // apply prefix
          if (prefix !== undefined) {
            applyPrefix(included, prefix);
          }

          if (typeof included === 'object') {
            if (Array.isArray(included)) {

              if (showif !== undefined) {
                for (var j = 0; j < included.length; j++) {
                  included[j]['show-if'] = showif;
                }
              }

              // insert several elements
              data.splice(i, 1, ...included);
            } else {
              if (showif !== undefined) {
                included['show-if'] = showif;
              }
              // just replace this entry with new dictionary
              data[i] = included;
            }
          }
        } else {
          loadIncludes(data[i]);
        }
      }
    }
    else {
      if ((data !== null) && ('@include' in data)) {
        // XXX - load this include
        var included = loadYaml(extensionContext.extensionPath + "/defs/" + data['location']);
        data.clear();
        for (var k in included) {
          data[k] = included[k];
        }
      }

      for (let key in data) {
        if (typeof data[key] === 'object') {
          loadIncludes(data[key]);
        }
      }
    }
  }
}

function applyPrefix(data: any, prefix: string) {
  if (typeof data === 'object') {
    if (Array.isArray(data)) {
      for (let i = data.length - 1; i >= 0; i--) {
        applyPrefix(data[i], prefix);
      }
    }
    else {
      for (let key in data) {
        if (typeof data[key] === 'object') {
          if (key === 'produces') {
            var produces = data['produces'];
            for (let i = 0; i < produces.length; i++) {
              if ('variable' in produces[i]) {
                produces[i]['variable'] = prefix + produces[i]['variable'];
              }
            }
          } else {
            applyPrefix(data[key], prefix);
          }
        }
      }
    }
  }
}
