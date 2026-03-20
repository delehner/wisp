export type MessageKind = 'text' | 'tool_use' | 'tool_result' | 'stderr';
export type AgentStatus = 'completed' | 'failed' | 'skipped' | 'max_iterations';

export interface AgentMeta {
  name: string;
  isBlocking: boolean;
}

export interface PipelineStats {
  total: number;
  passed: number;
  failed: number;
  elapsedMs: number;
}

export type ExtensionMessage =
  | { type: 'pipelineStart'; name: string; agents: AgentMeta[] }
  | { type: 'agentStart'; agent: string }
  | { type: 'agentLine'; agent: string; kind: MessageKind; text: string; toolName?: string; truncatedInput?: string }
  | { type: 'agentEnd'; agent: string; status: AgentStatus }
  | { type: 'awaitingInput'; agent: string }
  | { type: 'inputConsumed' }
  | { type: 'pipelineComplete'; prUrl?: string; stats: PipelineStats };

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'skipAgent' }
  | { type: 'continueAgent' }
  | { type: 'abortPipeline' };
