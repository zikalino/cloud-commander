import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';

console.log("Validation...");

var loader = new helpers.DefinitionLoader("./", "defs/____tree_templates.yaml");
var templates = loader.getYaml();

if (templates === null) {
  console.log("FAILED!!!");
  process.exit(1);
}