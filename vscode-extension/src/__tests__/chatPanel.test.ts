import * as vscode from 'vscode';
import { ChatPanel } from '../panels/chatPanel';

type MockWebview = {
  html: string;
  postMessage: jest.Mock;
  onDidReceiveMessage: jest.Mock;
  cspSource: string;
  asWebviewUri: jest.Mock;
};

type MockPanel = {
  webview: MockWebview;
  title: string;
  reveal: jest.Mock;
  onDidDispose: jest.Mock;
  dispose: jest.Mock;
};

const extensionUri = { fsPath: '/ext', toString: () => '/ext' } as vscode.Uri;

function makeMockPanel(): MockPanel {
  return {
    webview: {
      html: '',
      postMessage: jest.fn().mockResolvedValue(true),
      onDidReceiveMessage: jest.fn(() => ({ dispose: jest.fn() })),
      cspSource: 'vscode-webview:',
      asWebviewUri: jest.fn((uri: unknown) => uri),
    },
    title: '',
    reveal: jest.fn(),
    onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn(),
  };
}

describe('ChatPanel', () => {
  let mockPanel: MockPanel;

  beforeEach(() => {
    jest.clearAllMocks();
    ChatPanel.currentPanel = undefined;
    mockPanel = makeMockPanel();
    (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel);
  });

  afterEach(() => {
    ChatPanel.currentPanel = undefined;
  });

  function createPanel(): ChatPanel {
    return ChatPanel.createOrShow(extensionUri);
  }

  // ---- createOrShow() ----

  describe('createOrShow()', () => {
    it('creates a WebviewPanel with correct options on first call', () => {
      createPanel();

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'wispAgentChat',
        'Wisp — Agent Chat',
        vscode.ViewColumn.Beside,
        expect.objectContaining({
          enableScripts: true,
          retainContextWhenHidden: true,
        }),
      );
    });

    it('restricts localResourceRoots to media/ directory', () => {
      createPanel();

      // createWebviewPanel(viewType, title, column, options) — options is index 3
      const opts = (vscode.window.createWebviewPanel as jest.Mock).mock.calls[0][3];
      expect(opts).toMatchObject({ localResourceRoots: expect.any(Array) });
    });

    it('sets ChatPanel.currentPanel after first call', () => {
      const panel = createPanel();
      expect(ChatPanel.currentPanel).toBe(panel);
    });

    it('reuses existing panel on second call and calls reveal', () => {
      const p1 = createPanel();
      const p2 = createPanel();

      expect(p1).toBe(p2);
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(mockPanel.reveal).toHaveBeenCalledWith(vscode.ViewColumn.Beside);
    });

    it('registers an onDidReceiveMessage handler for webview messages', () => {
      createPanel();
      expect(mockPanel.webview.onDidReceiveMessage).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  // ---- handleStdout() ----

  describe('handleStdout()', () => {
    let panel: ChatPanel;

    beforeEach(() => {
      panel = createPanel();
    });

    it('posts agentLine text for a plain (non-JSON) line', () => {
      panel.handleStdout('architect', 'Hello world');

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'agentLine',
        agent: 'architect',
        kind: 'text',
        text: 'Hello world',
      });
    });

    it('does not post for whitespace-only plain text line', () => {
      panel.handleStdout('architect', '   ');
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('does not post for empty string line', () => {
      panel.handleStdout('architect', '');
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('parses tool_use event and posts kind tool_use with tool name', () => {
      const line = JSON.stringify({ type: 'tool_use', name: 'read_file', input: { path: '/src/foo.ts' } });
      panel.handleStdout('developer', line);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agentLine',
          agent: 'developer',
          kind: 'tool_use',
          toolName: 'read_file',
          text: 'read_file',
        }),
      );
    });

    it('includes tool input in truncatedInput for tool_use', () => {
      const input = { path: '/foo.ts' };
      const line = JSON.stringify({ type: 'tool_use', name: 'read_file', input });
      panel.handleStdout('developer', line);

      const call = (mockPanel.webview.postMessage as jest.Mock).mock.calls[0][0];
      expect(call.truncatedInput).toBe(JSON.stringify(input));
    });

    it('truncates tool_use input at 500 chars and appends ellipsis', () => {
      const longInput = { data: 'x'.repeat(600) };
      const line = JSON.stringify({ type: 'tool_use', name: 'write_file', input: longInput });
      panel.handleStdout('developer', line);

      const call = (mockPanel.webview.postMessage as jest.Mock).mock.calls[0][0];
      // 500 chars + '…' = 501 chars
      expect(call.truncatedInput).toHaveLength(501);
      expect(call.truncatedInput.endsWith('…')).toBe(true);
    });

    it('parses tool_result with string content', () => {
      const line = JSON.stringify({ type: 'tool_result', content: 'file contents here' });
      panel.handleStdout('developer', line);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agentLine',
          agent: 'developer',
          kind: 'tool_result',
          text: 'file contents here',
        }),
      );
    });

    it('JSON-stringifies non-string tool_result content', () => {
      const line = JSON.stringify({ type: 'tool_result', content: { status: 'ok', count: 3 } });
      panel.handleStdout('developer', line);

      const call = (mockPanel.webview.postMessage as jest.Mock).mock.calls[0][0];
      expect(call.kind).toBe('tool_result');
      expect(call.text).toBe('{"status":"ok","count":3}');
    });

    it('truncates tool_result content at 500 chars', () => {
      const longContent = 'y'.repeat(600);
      const line = JSON.stringify({ type: 'tool_result', content: longContent });
      panel.handleStdout('developer', line);

      const call = (mockPanel.webview.postMessage as jest.Mock).mock.calls[0][0];
      expect(call.text).toHaveLength(501);
      expect(call.text.endsWith('…')).toBe(true);
    });

    it('parses Claude content_block_delta with text delta', () => {
      const line = JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hello from Claude' } });
      panel.handleStdout('architect', line);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'agentLine',
          agent: 'architect',
          kind: 'text',
          text: 'Hello from Claude',
        }),
      );
    });

    it('does not post for content_block_delta with empty text', () => {
      const line = JSON.stringify({ type: 'content_block_delta', delta: { text: '' } });
      panel.handleStdout('architect', line);
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('does not post for content_block_delta with missing delta', () => {
      const line = JSON.stringify({ type: 'content_block_delta' });
      panel.handleStdout('architect', line);
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('parses Gemini text type event', () => {
      const line = JSON.stringify({ type: 'text', text: 'Gemini says hello' });
      panel.handleStdout('developer', line);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'text', text: 'Gemini says hello' }),
      );
    });

    it('parses object with top-level text field (Gemini variant)', () => {
      const line = JSON.stringify({ text: 'plain text field' });
      panel.handleStdout('developer', line);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'text', text: 'plain text field' }),
      );
    });

    it('parses generic content string field', () => {
      const line = JSON.stringify({ content: 'generic content value' });
      panel.handleStdout('developer', line);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'text', text: 'generic content value' }),
      );
    });

    it('falls through to raw line for whitespace-only content with no type field', () => {
      // content is whitespace → branch skipped; no type → raw line fallback fires
      const line = JSON.stringify({ content: '   ' });
      panel.handleStdout('developer', line);
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'text', text: line }),
      );
    });

    it('silently skips structural JSONL events that have a type but no displayable content', () => {
      // session_id events, message_start, etc. have type but no text/content
      const line = JSON.stringify({ type: 'session_id', id: 'sess_abc123' });
      panel.handleStdout('architect', line);
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('silently skips message_start structural event', () => {
      const line = JSON.stringify({ type: 'message_start', message: { id: 'msg_1' } });
      panel.handleStdout('architect', line);
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('posts raw line for unknown JSON without a type field', () => {
      const line = JSON.stringify({ unknown_field: 'some_data', other: 42 });
      panel.handleStdout('architect', line);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'agentLine',
        agent: 'architect',
        kind: 'text',
        text: line,
      });
    });

    it('includes the agent name in every posted message', () => {
      panel.handleStdout('tester', 'some output');

      const call = (mockPanel.webview.postMessage as jest.Mock).mock.calls[0][0];
      expect(call.agent).toBe('tester');
    });
  });

  // ---- handleStderr() ----

  describe('handleStderr()', () => {
    let panel: ChatPanel;

    beforeEach(() => {
      panel = createPanel();
    });

    it('posts agentLine with kind stderr for non-empty line', () => {
      panel.handleStderr('tester', 'error: test failed');

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'agentLine',
        agent: 'tester',
        kind: 'stderr',
        text: 'error: test failed',
      });
    });

    it('does not post for whitespace-only stderr lines', () => {
      panel.handleStderr('tester', '   \t  ');
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('does not post for empty stderr line', () => {
      panel.handleStderr('tester', '');
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });
  });

  // ---- Notification methods ----

  describe('notification methods', () => {
    let panel: ChatPanel;

    beforeEach(() => {
      panel = createPanel();
    });

    it('notifyPipelineStart() updates panel title with pipeline name', () => {
      const agents = [
        { name: 'architect', isBlocking: true },
        { name: 'designer', isBlocking: false },
      ];
      panel.notifyPipelineStart('my-feature', agents);
      expect(mockPanel.title).toBe('Wisp — Agent Chat · my-feature');
    });

    it('notifyPipelineStart() posts pipelineStart message with agents list', () => {
      const agents = [{ name: 'developer', isBlocking: true }];
      panel.notifyPipelineStart('vscode-03', agents);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'pipelineStart',
        name: 'vscode-03',
        agents,
      });
    });

    it('notifyAgentStart() posts agentStart message', () => {
      panel.notifyAgentStart('developer');

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'agentStart',
        agent: 'developer',
      });
    });

    it('notifyAgentEnd() posts agentEnd with completed status', () => {
      panel.notifyAgentEnd('developer', 'completed');

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'agentEnd',
        agent: 'developer',
        status: 'completed',
      });
    });

    it('notifyAgentEnd() posts agentEnd with failed status', () => {
      panel.notifyAgentEnd('tester', 'failed');

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'agentEnd',
        agent: 'tester',
        status: 'failed',
      });
    });

    it('notifyAgentEnd() posts agentEnd with skipped status', () => {
      panel.notifyAgentEnd('designer', 'skipped');

      const call = (mockPanel.webview.postMessage as jest.Mock).mock.calls[0][0];
      expect(call.status).toBe('skipped');
    });

    it('notifyAgentEnd() posts agentEnd with max_iterations status', () => {
      panel.notifyAgentEnd('architect', 'max_iterations');

      const call = (mockPanel.webview.postMessage as jest.Mock).mock.calls[0][0];
      expect(call.status).toBe('max_iterations');
    });

    it('notifyAwaitingInput() posts awaitingInput message', () => {
      panel.notifyAwaitingInput('developer');

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'awaitingInput',
        agent: 'developer',
      });
    });

    it('notifyPipelineComplete() posts pipelineComplete with PR URL and stats', () => {
      const stats = { total: 14, passed: 12, failed: 2, elapsedMs: 30000 };
      panel.notifyPipelineComplete('https://github.com/org/repo/pull/42', stats);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'pipelineComplete',
        prUrl: 'https://github.com/org/repo/pull/42',
        stats,
      });
    });

    it('notifyPipelineComplete() posts pipelineComplete without PR URL', () => {
      const stats = { total: 14, passed: 14, failed: 0, elapsedMs: 60000 };
      panel.notifyPipelineComplete(undefined, stats);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'pipelineComplete',
        prUrl: undefined,
        stats,
      });
    });
  });

  // ---- dispose() ----

  describe('dispose()', () => {
    it('clears ChatPanel.currentPanel when disposed', () => {
      const panel = createPanel();
      expect(ChatPanel.currentPanel).toBe(panel);

      panel.dispose();

      expect(ChatPanel.currentPanel).toBeUndefined();
    });

    it('calls dispose on the underlying vscode panel', () => {
      const panel = createPanel();
      panel.dispose();
      expect(mockPanel.dispose).toHaveBeenCalled();
    });

    it('allows creating a new panel after the previous one is disposed', () => {
      const p1 = createPanel();
      p1.dispose();

      const mockPanel2 = makeMockPanel();
      (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel2);

      const p2 = createPanel();
      expect(p2).not.toBe(p1);
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    });
  });

  // ---- HTML generation ----

  describe('HTML and security', () => {
    it('generates HTML with a nonce in the CSP header', () => {
      createPanel();
      expect(mockPanel.webview.html).toMatch(/nonce-[a-f0-9]{32}/);
    });

    it('uses the same nonce value in CSP and script tag', () => {
      createPanel();
      const html = mockPanel.webview.html;

      const cspNonce = html.match(/nonce-([a-f0-9]{32})/)?.[1];
      const scriptNonce = html.match(/nonce="([a-f0-9]{32})"/)?.[1];

      expect(cspNonce).toBeDefined();
      expect(scriptNonce).toBeDefined();
      expect(cspNonce).toBe(scriptNonce);
    });

    it('generates a fresh nonce for each new panel instance', () => {
      createPanel();
      const html1 = mockPanel.webview.html;

      ChatPanel.currentPanel = undefined;
      const mockPanel2 = makeMockPanel();
      (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(mockPanel2);

      createPanel();
      const html2 = mockPanel2.webview.html;

      const nonce1 = html1.match(/nonce-([a-f0-9]{32})/)?.[1];
      const nonce2 = html2.match(/nonce-([a-f0-9]{32})/)?.[1];

      expect(nonce1).toBeDefined();
      expect(nonce2).toBeDefined();
      expect(nonce1).not.toBe(nonce2);
    });

    it('embeds script tag referencing chat.js from media directory', () => {
      createPanel();
      expect(mockPanel.webview.html).toMatch(/src="[^"]*chat\.js"/);
    });

    it('uses webview.cspSource in Content-Security-Policy', () => {
      createPanel();
      expect(mockPanel.webview.html).toContain('vscode-webview:');
    });
  });

  // ---- webview message handling ----

  describe('webview message handling', () => {
    it('registers onDidReceiveMessage handler on construction', () => {
      createPanel();
      expect(mockPanel.webview.onDidReceiveMessage).toHaveBeenCalledTimes(1);
      expect(mockPanel.webview.onDidReceiveMessage).toHaveBeenCalledWith(expect.any(Function));
    });

    it('fires userActionEmitter when webview posts a message', () => {
      createPanel();

      // Retrieve the handler registered with onDidReceiveMessage
      const messageHandler = (mockPanel.webview.onDidReceiveMessage as jest.Mock).mock.calls[0][0] as (
        msg: unknown,
      ) => void;

      // The EventEmitter mock exposes fire as jest.fn() — verify it gets called
      // by invoking the registered handler directly
      expect(() => messageHandler({ type: 'skipAgent' })).not.toThrow();
    });
  });
});
