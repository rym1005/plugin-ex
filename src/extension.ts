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
            padding: 20px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        
        .header {
            margin-bottom: 30px;
            text-align: center;
        }
        
        .header h2 {
            color: var(--vscode-foreground);
            margin-bottom: 10px;
        }
        
        .step {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            margin-bottom: 20px;
            padding: 20px;
            background: var(--vscode-panel-background);
            transition: all 0.2s ease;
        }
        
        .step:hover {
            border-color: var(--vscode-focusBorder);
        }
        
        .step-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }
        
        .check-icon {
            font-size: 18px;
            font-weight: bold;
            margin-right: 10px;
            min-width: 25px;
            text-align: center;
        }
        
        .check-icon.completed {
            color: var(--vscode-terminal-ansiGreen);
        }
        
        .check-icon.failed {
            color: var(--vscode-errorForeground);
        }
        
        .check-icon.pending {
            color: var(--vscode-descriptionForeground);
        }
        
        .step-title {
            font-size: 16px;
            font-weight: bold;
            color: var(--vscode-foreground);
        }
        
        .step-description {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 15px;
            line-height: 1.4;
        }
        
        .input-group {
            margin-bottom: 15px;
        }
        
        .input-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }
        
        .input-group input[type="text"] {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            box-sizing: border-box;
            font-size: 14px;
        }
        
        .input-group input[type="text"]:focus {
            border-color: var(--vscode-focusBorder);
            outline: none;
        }
        
        .step-button {
            padding: 10px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: background-color 0.2s;
        }
        
        .step-button:hover:not(:disabled) {
            background: var(--vscode-button-hoverBackground);
        }
        
        .step-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            background: var(--vscode-button-secondaryBackground);
        }
        
        .step-button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .step-button.secondary:hover:not(:disabled) {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .progress-bar {
            width: 100%;
            height: 6px;
            background: var(--vscode-progressBar-background);
            border-radius: 3px;
            margin-bottom: 30px;
            overflow: hidden;
        }
        
        .progress-fill {
            height: 100%;
            background: var(--vscode-progressBar-foreground);
            width: 0%;
            transition: width 0.3s ease;
        }
        
        .status-message {
            margin-top: 10px;
            padding: 8px 12px;
            border-radius: 3px;
            font-size: 13px;
            display: none;
        }
        
        .status-message.success {
            background: var(--vscode-terminal-ansiGreen);
            color: var(--vscode-terminal-background);
        }
        
        .status-message.error {
            background: var(--vscode-errorBackground);
            color: var(--vscode-errorForeground);
        }
        
        .status-message.info {
            background: var(--vscode-infoBackground);
            color: var(--vscode-infoForeground);
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>Loplat iOS SDK 설치 가이드</h2>
        <div class="progress-bar">
            <div class="progress-fill" id="progressFill"></div>
        </div>
    </div>

    <!-- 1단계: SDK 설치 -->
    <div class="step" id="step1">
        <div class="step-header">
            <span class="check-icon pending" id="check1">◯</span>
            <span class="step-title">1단계: SDK 설치</span>
        </div>
        <div class="step-description">
            spm에서 Loplat SDK를 추가하고 프로젝트에 framework를 추가합니다.
        </div>
        <button class="step-button" onclick="applyStep(1)" id="button1">
            SDK 설치
        </button>
        <div class="status-message" id="status1"></div>
    </div>

    <!-- 2단계: 권한 설정 -->
    <div class="step" id="step2">
        <div class="step-header">
            <span class="check-icon pending" id="check2">◯</span>
            <span class="step-title">2단계: 권한 설정</span>
        </div>
        <div class="step-description">
            Info.plist에 위치 권한 사용 목적을 설정합니다.
        </div>
        <div class="input-group">
            <label for="locationUsage">위치 권한 사용 목적:</label>
            <input type="text" id="locationUsage" 
                   placeholder="예: 위치 기반 서비스 제공을 위해 사용됩니다"
                   onkeypress="handleEnterKey(event, 2)" />
        </div>
        <button class="step-button" onclick="applyStep(2)" id="button2">
            권한 설정 적용
        </button>
        <div class="status-message" id="status2"></div>
    </div>

    <!-- 3단계: 초기화 코드 삽입 -->
    <div class="step" id="step3">
        <div class="step-header">
            <span class="check-icon pending" id="check3">◯</span>
            <span class="step-title">3단계: 초기화 코드 삽입</span>
        </div>
        <div class="step-description">
            AppDelegate 또는 SceneDelegate에 Loplat SDK 초기화 코드를 추가합니다.
        </div>
        <div class="input-group">
            <label for="loplatId">Loplat ID:</label>
            <input type="text" id="loplatId" 
                   placeholder="예: your_loplat_id"
                   onkeypress="handleEnterKey(event, 3)" />
        </div>
        <div class="input-group">
            <label for="loplatPw">Loplat Password:</label>
            <input type="text" id="loplatPw" 
                   placeholder="예: your_loplat_password"
                   onkeypress="handleEnterKey(event, 3)" />
        </div>
        <button class="step-button" onclick="applyStep(3)" id="button3">
            초기화 코드 삽입
        </button>
        <div class="status-message" id="status3"></div>
    </div>

    <!-- 4단계: 빌드 & 테스트 -->
    <div class="step" id="step4">
        <div class="step-header">
            <span class="check-icon pending" id="check4">◯</span>
            <span class="step-title">4단계: 테스트</span>
        </div>
        <div class="step-description">
            Xcode 프로젝트에 SDK 설치가 정상적으로 완료되었는지 확인합니다.
        </div>
        <button class="step-button secondary" onclick="applyStep(4)" id="button4">
            빌드 실행
        </button>
        <div class="status-message" id="status4"></div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let completedSteps = new Set();

        function applyStep(step) {
            const button = document.getElementById(\`button\${step}\`);
            const statusDiv = document.getElementById(\`status\${step}\`);
            
            // 버튼 비활성화 및 로딩 상태
            button.disabled = true;
            button.textContent = '처리 중...';
            
            // 상태 메시지 초기화
            statusDiv.style.display = 'none';
            statusDiv.className = 'status-message';

            let messageData = { command: 'applyStep', step };

            // 각 단계별 추가 데이터 수집
            switch(step) {
                case 2:
                    messageData.locationUsage = document.getElementById('locationUsage').value;
                    break;
                case 3:
                    messageData.loplatId = document.getElementById('loplatId').value;
                    messageData.loplatPw = document.getElementById('loplatPw').value;
                    if (!messageData.loplatId || !messageData.loplatPw) {
                        showStatus(step, 'error', 'Loplat ID와 Password를 모두 입력해주세요.');
                        resetButton(step);
                        return;
                    }
                    break;
            }

            vscode.postMessage(messageData);
        }

        function handleEnterKey(event, step) {
            if (event.key === 'Enter') {
                applyStep(step);
            }
        }

        function showStatus(step, type, message) {
            const statusDiv = document.getElementById(\`status\${step}\`);
            statusDiv.className = \`status-message \${type}\`;
            statusDiv.textContent = message;
            statusDiv.style.display = 'block';
        }

        function resetButton(step) {
            const button = document.getElementById(\`button\${step}\`);
            const buttonTexts = [
                '', 'SDK 설치', '권한 설정 적용', '초기화 코드 삽입', '빌드 실행'
            ];
            button.disabled = false;
            button.textContent = buttonTexts[step];
        }

        function updateStepStatus(step, success, message = '') {
            const checkIcon = document.getElementById(\`check\${step}\`);
            const button = document.getElementById(\`button\${step}\`);
            
            if (success) {
                checkIcon.textContent = '✓';
                checkIcon.className = 'check-icon completed';
                completedSteps.add(step);
                showStatus(step, 'success', message || '완료되었습니다.');
                button.textContent = '완료됨';
                button.disabled = true;
            } else {
                checkIcon.textContent = '✗';
                checkIcon.className = 'check-icon failed';
                showStatus(step, 'error', message || '실패했습니다. 다시 시도해주세요.');
                resetButton(step);
            }
            
            updateProgress();
        }

        function updateProgress() {
            const progress = (completedSteps.size / 4) * 100;
            document.getElementById('progressFill').style.width = \`\${progress}%\`;
        }

        // Extension으로부터 메시지 수신
        window.addEventListener('message', event => {
            const { step, success, message } = event.data;
            if (step && typeof success === 'boolean') {
                updateStepStatus(step, success, message);
            }
        });

        // 초기 상태 설정
        updateProgress();
    </script>
</body>
</html>
        `;
    }
}
