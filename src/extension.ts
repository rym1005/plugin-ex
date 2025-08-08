import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension activated');
    
    // 웹뷰 프로바이더 등록
    const provider = new XcodeSidebarProvider(context.extensionUri);
    const disposable = vscode.window.registerWebviewViewProvider('xcodeSidebarView', provider, {
        webviewOptions: {
            retainContextWhenHidden: true
        }
    });
    
    context.subscriptions.push(disposable);
    console.log('WebviewViewProvider registered');
}

export function deactivate() {}

class XcodeSidebarProvider implements vscode.WebviewViewProvider {
    constructor(private readonly _extensionUri: vscode.Uri) {}

    resolveWebviewView(
        view: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        view.webview.options = {
            enableScripts: true
        };

        view.webview.html = this.getHtml(view.webview);

        // 웹뷰에서 메시지 수신
        view.webview.onDidReceiveMessage(async message => {
            if (message.command === 'insertXcodeCode') {
                const loplatId = message.loplatId;
                const loplatPw = message.loplatPw;
                
                if (!loplatId || loplatId.trim() === '') {
                    vscode.window.showWarningMessage("Loplat ID를 입력해주세요.");
                    return;
                }
                
                if (!loplatPw || loplatPw.trim() === '') {
                    vscode.window.showWarningMessage("Loplat PW를입력해주세요.");
                    return;
                }

                // Xcode 코드 삽입 로직 실행
                await this.insertXcodeCode(loplatId,loplatPw);
            }
        });
    }

    private async insertXcodeCode(loplatId: string,loplatPw: string) {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("작업 공간이 열려 있지 않습니다.");
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        if (!this.isXcodeProject(rootPath)) {
            vscode.window.showErrorMessage("Xcode 프로젝트가 아닙니다.");
            return;
        }

        let targetFile = this.findSwiftFile(rootPath, 'AppDelegate.swift');
        if (targetFile) {
            // AppDelegate.swift 파일이 있는 경우
            const lineToInsert = `
          if Plengi.initialize(clientID: "${loplatId}", clientSecret: "${loplatPw}") == .SUCCESS {
              // TODO : EchoCode 등록 필요시 등록
              //  Plengi.setEchoCode(echoCode: "고객사 별 사용자를 식별할 수 있는 코드 (개인정보 주의바람)")
          } else {
              // init 실패
          }`;
            this.insertLineIntoSwiftFile(targetFile, lineToInsert, 'func application', loplatId, loplatPw);
        } else {
            // AppDelegate.swift 파일이 없는 경우, @main 파일을 찾음
            targetFile = this.findMainAnnotatedFile(rootPath);
            if (!targetFile) {
                vscode.window.showErrorMessage("AppDelegate.swift 또는 @main 파일을 찾을 수 없습니다.");
                return;
            }

            const lineToInsert = `
      init() {
        if Plengi.initialize(clientID: "${loplatId}", clientSecret: "${loplatPw}") == .SUCCESS {
            // TODO : EchoCode 등록 필요시 등록
            //  Plengi.setEchoCode(echoCode: "고객사 별 사용자를 식별할 수 있는 코드 (개인정보 주의바람)")
        } else {
            // init 실패
        }
      }`;
            this.insertLineIntoSwiftFile(targetFile, lineToInsert, 'struct', loplatId, loplatPw);
        }
    }

    private isXcodeProject(rootPath: string): boolean {
        const files = fs.readdirSync(rootPath);
        return files.some(file => file.endsWith('.xcodeproj') || file.endsWith('.xcworkspace'));
    }

    private findSwiftFile(dir: string, targetFileName: string): string | null {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    // .git, .build, .xcodeproj, .xcworkspace 디렉토리는 무시
                    if (item === '.git' || item === '.build' || item.endsWith('.xcodeproj') || item.endsWith('.xcworkspace')) {
                        continue;
                    }
                    const result = this.findSwiftFile(fullPath, targetFileName);
                    if (result) { return result; }
                } else if (item === targetFileName) {
                    return fullPath;
                }
            } catch (error) {
                console.error(`Error accessing path: ${fullPath}`, error);
            }
        }
        return null;
    }

    private findMainAnnotatedFile(dir: string): string | null {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isDirectory()) {
                    if (item === '.git' || item === '.build' || item.endsWith('.xcodeproj') || item.endsWith('.xcworkspace')) {
                        continue;
                    }
                    const result = this.findMainAnnotatedFile(fullPath);
                    if (result) { return result; }
                } else if (item.endsWith('.swift')) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    if (content.includes('@main')) {
                        return fullPath;
                    }
                }
            } catch (error) {
                console.error(`Error accessing path: ${fullPath}`, error);
            }
        }
        return null;
    }

    private insertLineIntoSwiftFile(filePath: string, lineToInsert: string, targetKeyword: 'func application' | 'struct', loplatId: string, loplatPw: string) {
        const content = fs.readFileSync(filePath, 'utf8');

        // 코드 중복 삽입 방지
        if (content.includes('Plengi.initialize')) {
            vscode.window.showInformationMessage("Plengi SDK 초기화 코드가 이미 파일에 존재합니다.");
            return;
        }

        const lines = content.split('\n');

        // import Plengi 추가
        const plengiImportExists = lines.some(line => line.trim() === 'import Plengi');
        if (!plengiImportExists) {
            let lastImportIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim().startsWith('import ')) {
                    lastImportIndex = i;
                }
            }
            lines.splice(lastImportIndex + 1, 0, 'import Plengi');
        }

        if (targetKeyword === 'func application') {
            const insertionIndex = lines.findIndex(line =>
                line.includes('func application') && line.includes('didFinishLaunchingWithOptions')
            );
            if (insertionIndex !== -1) {
                lines.splice(insertionIndex + 1, 0, lineToInsert);
                fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
                vscode.window.showInformationMessage("코드가 성공적으로 삽입되었습니다!");
                return;
            }
        } else if (targetKeyword === 'struct') {
            const initExists = lines.some(line => line.trim().startsWith('init()'));
            if (initExists) {
                // init()이 이미 존재하면, 그 안에 Plengi.initialize 코드만 추가
                const initStartIndex = lines.findIndex(line => line.trim().startsWith('init()'));
                if (initStartIndex !== -1) {
                    const plengiInitCode = `
          if Plengi.initialize(clientID: "${loplatId}", clientSecret: "${loplatPw}") == .SUCCESS {
              // TODO : EchoCode 등록 필요시 등록
              //  Plengi.setEchoCode(echoCode: "고객사 별 사용자를 식별할 수 있는 코드 (개인정보 주의바람)")
          } else {
              // init 실패
          }`;
                    lines.splice(initStartIndex + 1, 0, plengiInitCode);
                    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
                    vscode.window.showInformationMessage("코드가 성공적으로 삽입되었습니다!");
                    return;
                }
            } else {
                // init()이 없으면 struct 안에 init()과 함께 삽입
                const structIndex = lines.findIndex(line => line.includes('struct') && line.includes('App'));
                if (structIndex !== -1) {
                    lines.splice(structIndex + 1, 0, lineToInsert);
                    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
                    vscode.window.showInformationMessage("코드가 성공적으로 삽입되었습니다!");
                    return;
                }
            }
        }

        vscode.window.showErrorMessage("코드를 삽입할 적절한 위치를 찾지 못했습니다.");
    }

    private getHtml(webview: vscode.Webview): string {
        return `
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 15px;
                    }
                    .input-group {
                        margin-bottom: 15px;
                    }
                    label {
                        display: block;
                        margin-bottom: 5px;
                        font-weight: bold;
                    }
                    input[type="text"] {
                        width: 100%;
                        padding: 8px;
                        border: 1px solid var(--vscode-input-border);
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 3px;
                        box-sizing: border-box;
                    }
                    button {
                        width: 100%;
                        padding: 10px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 3px;
                        cursor: pointer;
                        font-size: 14px;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    button:disabled {
                        opacity: 0.6;
                        cursor: not-allowed;
                    }
                </style>
            </head>
            <body>
                <h3>Loplat ID / PW </h3>
                <div class="input-group">
                    <label for="loplatId">Loplat ID:</label>
                    <input type="text" id="loplatId" placeholder="예: abc123" />
                </div>
                <div class="input-group">
                    <label for="loplatPw">Loplat PW:</label>
                    <input type="text" id="loplatPw" placeholder="예: abc123" />
                </div>
                
                <button onclick="insertCode()">Loplat sdk 탑재</button>

                <script>
                    const vscode = acquireVsCodeApi();
                    
                    function insertCode() {
                        const loplatId = document.getElementById('loplatId').value;
                        const loplatPw = document.getElementById('loplatPw').value;
                        vscode.postMessage({ 
                            command: 'insertXcodeCode', 
                            loplatId: loplatId ,
                            loplatPw: loplatPw 
                        });
                    }

                    // Enter 키로도 실행 가능
                    document.getElementById('loplatPw').addEventListener('keypress', function(e) {
                        if (e.key === 'Enter') {
                            insertCode();
                        }
                    });
                </script>
            </body>
            </html>
        `;
    }
}
