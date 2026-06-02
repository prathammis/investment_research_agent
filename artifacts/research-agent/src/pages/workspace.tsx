import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  FileText, Plus, Trash2, MessageSquare, ChevronRight,
  Loader2, AlertCircle, CheckCircle2, Clock, RefreshCw,
  TrendingUp, Search, Newspaper, BookOpen, BarChart2,
  Send, ChevronDown, ChevronUp, X
} from "lucide-react";
import {
  useListDocuments,
  useDeleteDocument,
  useListSessions,
  useGetSessionMessages,
  useDeleteSession,
  useAskResearch,
  useGetDocumentSummary,
  getListDocumentsQueryKey,
  getListSessionsQueryKey,
  getGetSessionMessagesQueryKey,
} from "@workspace/api-client-react";
import type {
  Document,
  ResearchSession,
  ResearchMessage,
  ToolCall,
} from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const TOOL_ICONS: Record<string, React.ElementType> = {
  rag_search: Search,
  news_search: Newspaper,
  financial_metrics: BarChart2,
  summarize: BookOpen,
};

const TOOL_LABELS: Record<string, string> = {
  rag_search: "Document Search",
  news_search: "News Search",
  financial_metrics: "Financial Metrics",
  summarize: "Summarize",
};

function ToolCallCard({ tc }: { tc: ToolCall }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[tc.tool] ?? Search;
  const label = TOOL_LABELS[tc.tool] ?? tc.tool;
  let inputObj: Record<string, string> = {};
  try { inputObj = JSON.parse(tc.input); } catch { /* */ }
  const inputSummary = Object.values(inputObj).join(", ");

  return (
    <div className="rounded border border-border bg-muted/30 text-xs overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
      >
        <Icon className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground truncate flex-1">{inputSummary}</span>
        {open ? <ChevronUp className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          <div>
            <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium mb-0.5">Input</p>
            <pre className="text-foreground whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{tc.input}</pre>
          </div>
          <div>
            <p className="text-muted-foreground uppercase tracking-wider text-[10px] font-medium mb-0.5">Output</p>
            <p className="text-muted-foreground leading-relaxed">{tc.output}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }: { msg: ResearchMessage }) {
  const isUser = msg.role === "user";
  const tcs = (msg.toolCalls as ToolCall[] | null) ?? [];
  return (
    <div className={cn("group", isUser ? "flex justify-end" : "")}>
      {!isUser && (
        <div className="flex items-center gap-2 mb-2">
          <div className="w-5 h-5 rounded-sm bg-primary flex items-center justify-center">
            <TrendingUp className="w-3 h-3 text-primary-foreground" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">Research Agent</span>
        </div>
      )}
      <div className={cn(
        "rounded px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
        isUser
          ? "bg-primary text-primary-foreground max-w-[80%] ml-auto"
          : "bg-card border border-border text-foreground w-full"
      )}>
        {msg.content}
      </div>
      {!isUser && tcs.length > 0 && (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Tool calls</p>
          {tcs.map((tc, i) => <ToolCallCard key={i} tc={tc} />)}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>
  );
}

function ChatArea({
  document: doc,
  sessionId,
  onSessionCreated,
}: {
  document: Document;
  sessionId: string | null;
  onSessionCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [localMessages, setLocalMessages] = useState<ResearchMessage[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: fetchedMessages, isLoading: loadingMessages } = useGetSessionMessages(
    sessionId ?? "",
    { query: { enabled: !!sessionId } as never }
  );
  const { data: summary, isLoading: summaryLoading } = useGetDocumentSummary(
    doc.id,
    { query: { enabled: doc.status === "ready" } as never }
  );

  const messages = sessionId ? (fetchedMessages ?? localMessages) : localMessages;

  const askMutation = useAskResearch({
    mutation: {
      onSuccess: (data) => {
        if (!sessionId) {
          onSessionCreated(data.sessionId);
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        } else {
          queryClient.invalidateQueries({ queryKey: getGetSessionMessagesQueryKey(sessionId) });
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        }
        setLocalMessages([]);
      },
      onError: () => {
        toast.error("Failed to get response. Please try again.");
        setLocalMessages((prev) => prev.slice(0, -1));
      },
    },
  });

  const handleSend = () => {
    const q = question.trim();
    if (!q || askMutation.isPending || doc.status !== "ready") return;
    setQuestion("");
    const optimistic: ResearchMessage = {
      id: `opt-${Date.now()}`,
      sessionId: sessionId ?? "",
      role: "user",
      content: q,
      createdAt: new Date().toISOString(),
      toolCalls: [],
    };
    setLocalMessages((prev) => [...prev, optimistic]);
    askMutation.mutate({ data: { question: q, documentId: doc.id, sessionId: sessionId ?? null } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, fetchedMessages, askMutation.isPending]);

  const displayMessages = sessionId && fetchedMessages ? fetchedMessages : localMessages;

  return (
    <div className="flex flex-col h-full">
      {/* Doc header */}
      <div className="border-b border-border px-6 py-3 flex items-start gap-3 flex-shrink-0">
        <FileText className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{doc.companyName}</h2>
          <p className="text-xs text-muted-foreground">{doc.fileName} &middot; {doc.chunkCount} chunks indexed</p>
        </div>
        <div className="ml-auto">
          {doc.status === "ready" && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium text-emerald-500">
              <CheckCircle2 className="w-3 h-3" /> Ready
            </span>
          )}
          {doc.status === "processing" && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium text-amber-500">
              <Loader2 className="w-3 h-3 animate-spin" /> Indexing
            </span>
          )}
          {doc.status === "error" && (
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium text-destructive">
              <AlertCircle className="w-3 h-3" /> Error
            </span>
          )}
        </div>
      </div>

      {/* Summary strip */}
      {!sessionId && doc.status === "ready" && summary && (
        <div className="border-b border-border px-6 py-4 bg-muted/20">
          {summaryLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading summary...
            </div>
          ) : (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Executive Summary</p>
              <p className="text-xs text-foreground leading-relaxed line-clamp-3">{summary.summary}</p>
              {summary.keyMetrics && summary.keyMetrics.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {summary.keyMetrics.slice(0, 6).map((m, i) => (
                    <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-sm bg-primary/10 text-primary text-[11px] font-medium border border-primary/20">
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {loadingMessages && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {displayMessages.length === 0 && !loadingMessages && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded border border-border bg-card flex items-center justify-center mb-4">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">Start your research</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Ask anything about {doc.companyName} — financials, strategy, risks, or market position.
            </p>
            {doc.status === "processing" && (
              <p className="text-xs text-amber-500 mt-3 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Document is being indexed. This usually takes 1-2 minutes.
              </p>
            )}
          </div>
        )}

        {displayMessages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {askMutation.isPending && !displayMessages.find(m => m.id.startsWith("opt-") && m.role === "user") && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-sm bg-primary flex items-center justify-center">
                <TrendingUp className="w-3 h-3 text-primary-foreground" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">Research Agent</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-card border border-border rounded px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Analyzing with tools...
            </div>
          </div>
        )}

        {askMutation.isPending && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-sm bg-primary flex items-center justify-center">
                <TrendingUp className="w-3 h-3 text-primary-foreground" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">Research Agent</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-card border border-border rounded px-4 py-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Analyzing with tools...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 py-4 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              doc.status !== "ready"
                ? "Waiting for document to finish indexing..."
                : `Ask about ${doc.companyName}...`
            }
            disabled={doc.status !== "ready" || askMutation.isPending}
            rows={1}
            className="flex-1 resize-none rounded border border-border bg-card px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed leading-relaxed"
            style={{ minHeight: "42px", maxHeight: "120px" }}
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!question.trim() || doc.status !== "ready" || askMutation.isPending}
            className="h-[42px] w-[42px] flex items-center justify-center rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            {askMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 ml-1">
          Enter to send &middot; Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

export default function ResearchWorkspace() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"documents" | "sessions">("documents");

  const { data: documents = [], isLoading: docsLoading, refetch: refetchDocs } = useListDocuments();
  const { data: sessions = [], isLoading: sessionsLoading } = useListSessions();

  const deleteDocMutation = useDeleteDocument({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
        toast.success("Document deleted");
        if (selectedDocId) setSelectedDocId(null);
      },
    },
  });

  const deleteSessionMutation = useDeleteSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        toast.success("Session deleted");
        if (selectedSessionId) { setSelectedSessionId(null); }
      },
    },
  });

  // Poll for processing documents
  useEffect(() => {
    const processing = documents.filter((d) => d.status === "processing");
    if (processing.length === 0) return;
    const t = setInterval(() => refetchDocs(), 4000);
    return () => clearInterval(t);
  }, [documents, refetchDocs]);

  const selectedDoc = documents.find((d) => d.id === selectedDocId) ?? null;

  const handleSelectSession = (session: ResearchSession) => {
    setSelectedDocId(session.documentId);
    setSelectedSessionId(session.id);
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-border flex flex-col">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-sm bg-primary flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold text-foreground tracking-tight">ResearchAI</span>
          </div>
          <button
            onClick={() => navigate("/upload")}
            title="Upload report"
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border text-xs">
          <button
            onClick={() => setActiveTab("documents")}
            className={cn(
              "flex-1 py-2.5 font-medium transition-colors",
              activeTab === "documents"
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Reports
          </button>
          <button
            onClick={() => setActiveTab("sessions")}
            className={cn(
              "flex-1 py-2.5 font-medium transition-colors",
              activeTab === "sessions"
                ? "text-foreground border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Sessions
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-2">
          {activeTab === "documents" && (
            <>
              {docsLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {!docsLoading && documents.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <FileText className="w-7 h-7 text-muted-foreground mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No reports yet</p>
                  <button
                    onClick={() => navigate("/upload")}
                    className="mt-2 text-xs text-primary hover:underline"
                  >
                    Upload your first report
                  </button>
                </div>
              )}
              {documents.map((doc) => (
                <div key={doc.id} className="group relative">
                  <button
                    onClick={() => { setSelectedDocId(doc.id); setSelectedSessionId(null); }}
                    className={cn(
                      "w-full text-left px-4 py-3 flex flex-col gap-0.5 hover:bg-muted/50 transition-colors",
                      selectedDocId === doc.id && !selectedSessionId ? "bg-muted/70" : ""
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground truncate flex-1">{doc.companyName}</span>
                      {doc.status === "ready" && <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />}
                      {doc.status === "processing" && <Loader2 className="w-3 h-3 text-amber-500 animate-spin flex-shrink-0" />}
                      {doc.status === "error" && <AlertCircle className="w-3 h-3 text-destructive flex-shrink-0" />}
                    </div>
                    <span className="text-[10px] text-muted-foreground truncate">{doc.fileName}</span>
                    {doc.status === "ready" && (
                      <span className="text-[10px] text-muted-foreground">{doc.chunkCount} chunks</span>
                    )}
                    {doc.status === "processing" && (
                      <span className="text-[10px] text-amber-500">Indexing...</span>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteDocMutation.mutate({ id: doc.id });
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </>
          )}

          {activeTab === "sessions" && (
            <>
              {sessionsLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {!sessionsLoading && sessions.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <MessageSquare className="w-7 h-7 text-muted-foreground mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No sessions yet</p>
                </div>
              )}
              {sessions.map((session) => (
                <div key={session.id} className="group relative">
                  <button
                    onClick={() => handleSelectSession(session)}
                    className={cn(
                      "w-full text-left px-4 py-3 flex flex-col gap-0.5 hover:bg-muted/50 transition-colors",
                      selectedSessionId === session.id ? "bg-muted/70" : ""
                    )}
                  >
                    <span className="text-xs font-medium text-foreground truncate">{session.companyName}</span>
                    {session.lastMessage && (
                      <span className="text-[10px] text-muted-foreground truncate">{session.lastMessage}</span>
                    )}
                    <div className="flex items-center gap-1 mt-0.5">
                      <MessageSquare className="w-2.5 h-2.5 text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">{session.messageCount} msgs</span>
                      <Clock className="w-2.5 h-2.5 text-muted-foreground ml-1" />
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(session.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSessionMutation.mutate({ sessionId: session.id });
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Upload button */}
        <div className="px-4 py-3 border-t border-border">
          <button
            onClick={() => navigate("/upload")}
            className="w-full flex items-center justify-center gap-2 rounded border border-dashed border-border py-2 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Upload Report
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedDoc ? (
          <ChatArea
            key={selectedDoc.id}
            document={selectedDoc}
            sessionId={selectedSessionId}
            onSessionCreated={(id) => setSelectedSessionId(id)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm">
              <div className="w-16 h-16 rounded border border-border bg-card flex items-center justify-center mx-auto mb-5">
                <TrendingUp className="w-7 h-7 text-muted-foreground" />
              </div>
              <h2 className="text-base font-semibold text-foreground mb-2">Investment Research Agent</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                Upload a company annual report, then ask the AI agent to analyze financials,
                search for news, extract key metrics, and synthesize findings.
              </p>
              <div className="grid grid-cols-2 gap-2 mb-6 text-left">
                {[
                  { icon: Search, label: "RAG Search", desc: "Semantic search over report" },
                  { icon: Newspaper, label: "News Search", desc: "Latest company news" },
                  { icon: BarChart2, label: "Financials", desc: "Extract key metrics" },
                  { icon: BookOpen, label: "Summarize", desc: "Section-level summaries" },
                ].map(({ icon: Icon, label, desc }) => (
                  <div key={label} className="rounded border border-border bg-card px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Icon className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs font-medium text-foreground">{label}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{desc}</p>
                  </div>
                ))}
              </div>
              <button
                onClick={() => navigate("/upload")}
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                Upload Annual Report
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
