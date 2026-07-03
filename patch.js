const fs = require('fs');
let c = fs.readFileSync('src/main/tab-manager.ts', 'utf8');
const search = 'view.webContents.print() },';
const replace = 'view.webContents.print() },\n          {\n            label: \'Export to PDF\\u2026\',\n            click: async () => {\n              try {\n                const { dialog } = require(\'electron\');\n                const fs = require(\'fs\');\n                const title = view.webContents.getTitle() || \'Page\';\n                const result = await dialog.showSaveDialog({\n                  title: \'Export to PDF\',\n                  defaultPath: title.replace(/[^a-z0-9]/gi, \'_\') + \'.pdf\',\n                  filters: [{ name: \'PDF Document\', extensions: [\'pdf\'] }]\n                });\n                if (result.canceled || !result.filePath) return;\n                const pdfData = await view.webContents.printToPDF({});\n                fs.writeFileSync(result.filePath, pdfData);\n              } catch (e) {\n                console.error(\'Failed to export PDF:\', e);\n              }\n            }\n          },';
c = c.replace(search, replace);
fs.writeFileSync('src/main/tab-manager.ts', c);
