import * as vscode from 'vscode';
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

        var loader = new helpers.DefinitionLoader(extensionContext.extensionPath, "defs/" + submenu[i].location);
        let yml = loader.getYaml();

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

