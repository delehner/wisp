import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { AgentMeta, AgentStatus, ExtensionMessage, PipelineStats, WebviewMessage } from '../types/messages';

const MAX_TOOL_CHARS = 500;

export class ChatPanel {
  static currentPanel: ChatPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _userActionEmitter = new vscode.EventEmitter<WebviewMessage>();

  // Event fired when the WebView posts a user action (skip/continue/abort).
  readonly onUserAction: vscode.Event<WebviewMessage> = this._userActionEmitter.event;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.onDidDispose(() => this.dispose());
    this._setWebviewMessageHandler();
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
  }

  static createOrShow(extensionUri: vscode.Uri): ChatPanel {
    const column = vscode.ViewColumn.Beside;

    if (ChatPanel.currentPanel) {
      ChatPanel.currentPanel._panel.reveal(column);
      return ChatPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel('wispAgentChat', 'Wisp — Agent Chat', column, {
      enableScripts: true,
      // retainContextWhenHidden: preserves WebView state when the tab is hidden.
      // Trade-off: the WebView process remains alive, using additional memory.
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
    });

    ChatPanel.currentPanel = new ChatPanel(panel, extensionUri);
    return ChatPanel.currentPanel;
  }

  postMessage(msg: ExtensionMessage): void {
    void this._panel.webview.postMessage(msg);
  }

  notifyPipelineStart(name: string, agents: AgentMeta[]): void {
    this._panel.title = `Wisp — Agent Chat · ${name}`;
    this.postMessage({ type: 'pipelineStart', name, agents });
  }

  notifyAgentStart(agent: string): void {
    this.postMessage({ type: 'agentStart', agent });
  }

  /** Parse a JSONL line from CLI stdout and forward a structured message to the WebView. */
  handleStdout(agent: string, line: string): void {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Not JSON — treat as plain text
    }

    if (!parsed) {
      if (line.trim()) {
        this.postMessage({ type: 'agentLine', agent, kind: 'text', text: line });
      }
      return;
    }

    const type = parsed['type'] as string | undefined;

    if (type === 'tool_use') {
      const toolName = (parsed['name'] as string | undefined) ?? 'tool';
      const inputStr = JSON.stringify(parsed['input'] ?? {});
      const truncated =
        inputStr.length > MAX_TOOL_CHARS ? inputStr.slice(0, MAX_TOOL_CHARS) + '…' : inputStr;
      this.postMessage({
        type: 'agentLine',
        agent,
        kind: 'tool_use',
        text: toolName,
        toolName,
        truncatedInput: truncated,
      });
      return;
    }

    if (type === 'tool_result') {
      const content = parsed['content'];
      const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
      const truncated = text.length > MAX_TOOL_CHARS ? text.slice(0, MAX_TOOL_CHARS) + '…' : text;
      this.postMessage({ type: 'agentLine', agent, kind: 'tool_result', text: truncated });
      return;
    }

    // Claude stream: content_block_delta carries text deltas
    if (type === 'content_block_delta') {
      const delta = parsed['delta'] as Record<string, unknown> | undefined;
      const text = (delta?.['text'] as string | undefined) ?? '';
      if (text) {
        this.postMessage({ type: 'agentLine', agent, kind: 'text', text });
      }
      return;
    }

    // Gemini or simple text event
    if (type === 'text' || typeof parsed['text'] === 'string') {
      const text = (parsed['text'] as string | undefined) ?? line;
      if (text.trim()) {
        this.postMessage({ type: 'agentLine', agent, kind: 'text', text });
      }
      return;
    }

    // Generic content string field
    if (typeof parsed['content'] === 'string' && (parsed['content'] as string).trim()) {
      this.postMessage({
        type: 'agentLine',
        agent,
        kind: 'text',
        text: parsed['content'] as string,
      });
      return;
    }

    // Skip silent/structural JSONL events (session_id, etc.)
    if (type) {
      return;
    }

    // Unknown format — show raw
    this.postMessage({ type: 'agentLine', agent, kind: 'text', text: line });
  }

  handleStderr(agent: string, line: string): void {
    if (line.trim()) {
      this.postMessage({ type: 'agentLine', agent, kind: 'stderr', text: line });
    }
  }

  notifyAgentEnd(agent: string, status: AgentStatus): void {
    this.postMessage({ type: 'agentEnd', agent, status });
  }

  notifyAwaitingInput(agent: string): void {
    this.postMessage({ type: 'awaitingInput', agent });
  }

  notifyPipelineComplete(prUrl: string | undefined, stats: PipelineStats): void {
    this.postMessage({ type: 'pipelineComplete', prUrl, stats });
  }

  dispose(): void {
    ChatPanel.currentPanel = undefined;
    this._panel.dispose();
    this._userActionEmitter.dispose();
  }

  private _setWebviewMessageHandler(): void {
    this._panel.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      this._userActionEmitter.fire(msg);
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const chatScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'),
    );
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Wisp — Agent Chat</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden;
      clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

    .chat-root {
      display: grid;
      grid-template-rows: auto 1fr auto;
      grid-template-columns: max(160px, 20%) 1fr;
      height: 100vh;
      overflow: hidden;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }

    /* Header */
    .chat-header {
      grid-column: 1 / -1; grid-row: 1;
      display: flex; align-items: center; gap: 8px;
      padding: 6px 12px;
      background: var(--vscode-editorGroupHeader-tabsBackground);
      border-bottom: 1px solid var(--vscode-panel-border);
      font-weight: 600; font-size: 12px;
      text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
    }
    .chat-header .pipeline-name {
      color: var(--vscode-foreground); text-transform: none; letter-spacing: 0;
    }

    /* Timeline */
    .chat-timeline {
      grid-column: 1; grid-row: 2;
      overflow-y: auto;
      border-right: 1px solid var(--vscode-panel-border);
    }
    .timeline { padding: 8px 0; }
    .timeline-agent {
      display: flex; align-items: center; gap: 6px;
      padding: 5px 10px;
      cursor: pointer; font-size: 12px;
      color: var(--vscode-foreground);
      transition: background 0.1s;
      border-left: 2px solid transparent;
      background: none; border-top: none; border-right: none; border-bottom: none;
      width: 100%; text-align: left;
    }
    .timeline-agent:hover { background: var(--vscode-list-hoverBackground); }
    .timeline-agent:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .timeline-agent.active {
      border-left-color: var(--vscode-progressBar-background);
      background: var(--vscode-list-activeSelectionBackground);
    }
    .timeline-agent.non-blocking { color: var(--vscode-descriptionForeground); font-style: italic; }
    .timeline-icon { font-size: 14px; flex-shrink: 0; width: 18px; text-align: center; display: inline-block; }
    .timeline-icon.pending { color: var(--vscode-descriptionForeground); }
    .timeline-icon.running { color: var(--vscode-progressBar-background); animation: spin 1s linear infinite; }
    .timeline-icon.completed { color: var(--vscode-testing-iconPassed); }
    .timeline-icon.failed { color: var(--vscode-testing-iconFailed); }
    .timeline-icon.skipped { color: var(--vscode-testing-iconSkipped); }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    /* Chat Stream */
    .chat-stream {
      grid-column: 2; grid-row: 2;
      overflow-y: auto; scroll-behavior: smooth; position: relative;
    }
    .stream-inner { padding: 8px 0 16px; }
    .agent-section-header {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px 4px;
      font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--vscode-descriptionForeground);
    }
    .agent-section-header::after {
      content: ''; flex: 1; height: 1px;
      background: var(--vscode-panel-border);
    }

    /* Chat Bubble */
    .chat-bubble {
      margin: 4px 12px; padding: 8px 12px;
      border-radius: 4px;
      border-left: 3px solid var(--agent-accent, var(--vscode-panel-border));
      background: var(--vscode-input-background);
      font-size: 13px; line-height: 1.5; position: relative;
    }
    .chat-bubble.stderr {
      border-left-color: var(--vscode-descriptionForeground);
      font-style: italic; color: var(--vscode-descriptionForeground);
      background: transparent; padding-top: 2px; padding-bottom: 2px;
    }
    .chat-bubble-header {
      display: flex; justify-content: space-between; align-items: baseline;
      margin-bottom: 4px;
    }
    .chat-bubble-agent { font-weight: 600; font-size: 11px; color: var(--agent-accent); }
    .chat-bubble-timestamp {
      font-size: 10px; color: var(--vscode-descriptionForeground);
      opacity: 0; transition: opacity 0.15s;
    }
    .chat-bubble:hover .chat-bubble-timestamp { opacity: 1; }
    .chat-bubble-text { white-space: pre-wrap; word-break: break-word; }

    /* Tool Block */
    .tool-block {
      margin: 6px 0;
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px; overflow: hidden;
    }
    .tool-block summary {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 8px;
      background: var(--vscode-editor-background);
      cursor: pointer; font-size: 11px;
      font-family: var(--vscode-editor-font-family);
      list-style: none; user-select: none;
    }
    .tool-block summary::-webkit-details-marker { display: none; }
    .tool-block summary::before { content: '\u25B6'; font-size: 9px; transition: transform 0.15s; }
    .tool-block[open] summary::before { transform: rotate(90deg); }
    .tool-kind-badge {
      font-size: 10px; padding: 1px 4px; border-radius: 2px;
      background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .tool-name { font-weight: 600; color: var(--vscode-foreground); }
    .tool-truncated-hint { color: var(--vscode-descriptionForeground); font-style: italic; }
    .tool-body {
      padding: 6px 8px;
      background: var(--vscode-input-background);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      white-space: pre-wrap; word-break: break-all;
      max-height: 200px; overflow-y: auto;
    }
    .tool-result .tool-kind-badge { opacity: 0.7; }

    /* Controls Bar */
    .chat-controls {
      grid-column: 1 / -1; grid-row: 3;
      border-top: 1px solid var(--vscode-panel-border);
      padding: 0 16px; overflow: hidden;
      background: var(--vscode-editorWidget-background);
      display: flex; flex-direction: column; gap: 8px;
      max-height: 0; transition: max-height 0.2s ease-out, padding 0.2s ease-out;
    }
    .chat-controls.visible { max-height: 120px; padding: 10px 16px; }
    .controls-label {
      font-size: 11px; color: var(--vscode-descriptionForeground);
      display: flex; align-items: center; gap: 6px;
    }
    .controls-label::before {
      content: ''; display: inline-block; width: 8px; height: 8px;
      border-radius: 50%; background: var(--vscode-progressBar-background);
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
    .controls-buttons { display: flex; gap: 8px; flex-wrap: wrap; }
    .btn {
      padding: 4px 12px; border-radius: 3px; border: none;
      cursor: pointer; font-size: 12px; font-family: var(--vscode-font-family);
      transition: background 0.1s;
    }
    .btn:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .btn-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover:not(:disabled) { filter: brightness(1.1); }
    .btn-danger {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
      border: 1px solid var(--vscode-inputValidation-errorBorder);
    }
    .btn-danger:hover:not(:disabled) { filter: brightness(1.15); }

    /* Summary Card */
    .summary-card {
      margin: 16px 12px 12px; padding: 14px 16px;
      border-radius: 6px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editorWidget-background);
    }
    .summary-title {
      display: flex; align-items: center; gap: 8px;
      font-weight: 600; font-size: 14px; margin-bottom: 8px;
    }
    .summary-title .icon-pass { color: var(--vscode-testing-iconPassed); }
    .summary-title .icon-fail { color: var(--vscode-testing-iconFailed); }
    .summary-stats { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
    .summary-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .summary-link {
      color: var(--vscode-textLink-foreground); text-decoration: none;
      font-size: 12px; padding: 4px 12px;
      border: 1px solid var(--vscode-panel-border); border-radius: 3px;
    }
    .summary-link:hover { color: var(--vscode-textLink-activeForeground); }

    /* Clip Notice */
    .clip-notice {
      text-align: center; font-size: 11px;
      color: var(--vscode-descriptionForeground);
      padding: 6px; font-style: italic;
    }

    /* Scroll-to-bottom button */
    .scroll-btn {
      position: absolute; bottom: 12px; right: 12px;
      padding: 4px 10px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none; border-radius: 3px; cursor: pointer; font-size: 11px;
      opacity: 0; pointer-events: none; transition: opacity 0.15s;
    }
    .scroll-btn.visible { opacity: 1; pointer-events: auto; }

    /* Narrow responsive */
    .chat-root.narrow {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto 1fr auto;
    }
    .chat-root.narrow .chat-timeline {
      grid-column: 1; grid-row: 2;
      border-right: none; border-bottom: 1px solid var(--vscode-panel-border);
      overflow-y: hidden; overflow-x: auto; max-height: 48px;
    }
    .chat-root.narrow .chat-stream { grid-column: 1; grid-row: 3; }
    .chat-root.narrow .chat-controls { grid-column: 1; grid-row: 4; }
    .chat-root.narrow .timeline { display: flex; padding: 4px 8px; gap: 4px; }
    .chat-root.narrow .timeline-agent { width: auto; padding: 4px 6px; font-size: 11px; }
    .chat-root.narrow .timeline-agent span:not(.timeline-icon) { display: none; }
  </style>
</head>
<body>
<div class="chat-root" id="chatRoot" role="main">
  <header class="chat-header" aria-label="Wisp Agent Chat">
    <span>Wisp \u2014 Agent Chat</span>
    <span class="pipeline-name" id="pipelineName"></span>
  </header>

  <nav class="chat-timeline" aria-label="Agent timeline">
    <div class="timeline" id="timeline" role="list"></div>
  </nav>

  <main class="chat-stream" id="chatStream" role="log" aria-live="polite" aria-label="Agent output">
    <div class="stream-inner" id="streamInner"></div>
    <button class="scroll-btn" id="scrollBtn" aria-label="Scroll to bottom">\u2193 Latest</button>
  </main>

  <div class="chat-controls" id="chatControls" aria-live="assertive">
    <div class="controls-label" id="controlsLabel">Paused</div>
    <div class="controls-buttons">
      <button class="btn btn-secondary" id="btnSkip" disabled>Skip Agent</button>
      <button class="btn btn-primary" id="btnContinue" disabled>Continue</button>
      <button class="btn btn-danger" id="btnAbort" disabled>Abort Pipeline</button>
    </div>
  </div>
</div>

<div role="status" aria-live="polite" class="sr-only" id="statusAnnounce"></div>

<script nonce="${nonce}" src="${chatScriptUri}"></script>
</body>
</html>`;
  }
}
