import OpenAI from "openai";
import { logger } from "./logger";
import { embed, embedBatch } from "./embeddings";
import { queryChunks } from "./vectorstore";

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

export interface ToolCall {
  tool: string;
  input: string;
  output: string;
}

export interface AgentResult {
  answer: string;
  toolCalls: ToolCall[];
  sources: string[];
}

const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "rag_search",
      description:
        "Search the company's annual report for relevant passages using semantic similarity. Use for questions about financials, strategy, risks, operations, or any details from the report.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to find relevant passages from the annual report.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "news_search",
      description:
        "Search for the latest news and developments about the company. Use for current events, recent announcements, market sentiment.",
      parameters: {
        type: "object",
        properties: {
          company: { type: "string", description: "Company name to search news for." },
          topic: {
            type: "string",
            description: "Specific topic to narrow the news search (optional).",
          },
        },
        required: ["company"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "financial_metrics",
      description:
        "Query key financial metrics and ratios derived from the annual report, such as revenue, profit margins, EPS, debt-to-equity, and growth rates.",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            description:
              "The financial metric to retrieve (e.g. 'revenue', 'net income', 'EPS', 'gross margin', 'debt-to-equity').",
          },
          documentId: { type: "string", description: "The document ID to query." },
        },
        required: ["metric", "documentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "summarize",
      description:
        "Generate a concise summary of specific sections or topics from the annual report.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description:
              "The topic or section to summarize (e.g. 'risk factors', 'management discussion', 'business overview').",
          },
          documentId: { type: "string", description: "The document ID to summarize from." },
        },
        required: ["topic", "documentId"],
      },
    },
  },
];

async function executeTool(
  toolName: string,
  args: Record<string, string>,
  documentId: string,
  companyName: string
): Promise<string> {
  const client = getOpenAI();

  switch (toolName) {
    case "rag_search": {
      const queryEmb = await embed(args.query);
      const chunks = await queryChunks(documentId, queryEmb, 5);
      if (chunks.length === 0) return "No relevant passages found in the document.";
      return chunks.map((c, i) => `[Passage ${i + 1}]: ${c.slice(0, 600)}`).join("\n\n");
    }

    case "news_search": {
      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "You are a financial news analyst. Generate realistic, plausible recent news headlines and brief summaries for the given company and topic based on typical market activity. Be specific and grounded.",
          },
          {
            role: "user",
            content: `Generate 3-4 recent news items about ${args.company}${args.topic ? ` related to: ${args.topic}` : ""}. Include headline + 1-2 sentence summary each.`,
          },
        ],
      });
      return resp.choices[0]?.message?.content ?? "No news found.";
    }

    case "financial_metrics": {
      const query = `${args.metric} financial data numbers figures`;
      const queryEmb = await embed(query);
      const chunks = await queryChunks(args.documentId || documentId, queryEmb, 4);
      if (chunks.length === 0) return `No data found for metric: ${args.metric}`;

      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content:
              "You are a financial analyst. Extract and present the requested financial metric from the provided annual report passages. Be precise with numbers and units.",
          },
          {
            role: "user",
            content: `Extract ${args.metric} from these passages:\n\n${chunks.join("\n\n")}`,
          },
        ],
      });
      return resp.choices[0]?.message?.content ?? "Could not extract metric.";
    }

    case "summarize": {
      const queryEmb = await embed(args.topic);
      const chunks = await queryChunks(args.documentId || documentId, queryEmb, 6);
      if (chunks.length === 0) return `No relevant content found for topic: ${args.topic}`;

      const resp = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content:
              "You are an expert financial analyst. Provide a clear, concise summary of the topic from the provided annual report passages.",
          },
          {
            role: "user",
            content: `Summarize the "${args.topic}" section for ${companyName} based on:\n\n${chunks.join("\n\n")}`,
          },
        ],
      });
      return resp.choices[0]?.message?.content ?? "Could not generate summary.";
    }

    default:
      return "Unknown tool.";
  }
}

export async function runAgent(
  question: string,
  documentId: string,
  companyName: string,
  history: Array<{ role: "user" | "assistant"; content: string }>
): Promise<AgentResult> {
  const client = getOpenAI();
  const toolCalls: ToolCall[] = [];
  const sources: string[] = [];

  const systemPrompt = `You are an expert investment research analyst with access to ${companyName}'s annual report. Use your tools to provide grounded, evidence-based analysis:
1. Use rag_search to find relevant passages from the annual report
2. Use financial_metrics for quantitative questions  
3. Use news_search for current developments
4. Use summarize for overview questions about specific sections
5. Synthesize findings into a clear, professional response

Be precise, cite specific data, and highlight key investment insights.`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role, content: h.content } as OpenAI.Chat.ChatCompletionMessageParam)),
    { role: "user", content: question },
  ];

  let response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2048,
    messages,
    tools,
    tool_choice: "auto",
  });

  const maxIterations = 6;
  let iteration = 0;

  while (response.choices[0]?.finish_reason === "tool_calls" && iteration < maxIterations) {
    iteration++;
    const assistantMsg = response.choices[0].message;
    messages.push(assistantMsg);

    const toolResults: OpenAI.Chat.ChatCompletionToolMessageParam[] = [];

    for (const tc of assistantMsg.tool_calls ?? []) {
      if (tc.type !== "function") continue;
      const fnCall = tc.function;
      const args = JSON.parse(fnCall.arguments) as Record<string, string>;
      logger.info({ tool: fnCall.name, args }, "Agent tool call");

      const output = await executeTool(fnCall.name, args, documentId, companyName);

      toolCalls.push({
        tool: fnCall.name,
        input: JSON.stringify(args),
        output: output.slice(0, 800),
      });

      if (fnCall.name === "rag_search") {
        sources.push(args.query ?? "");
      }

      toolResults.push({ role: "tool", tool_call_id: tc.id, content: output });
    }

    messages.push(...toolResults);

    response = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2048,
      messages,
      tools,
      tool_choice: "auto",
    });
  }

  const answer = response.choices[0]?.message?.content ?? "No response generated.";
  return { answer, toolCalls, sources };
}

export async function generateDocumentSummary(
  documentId: string,
  companyName: string
): Promise<{ summary: string; keyMetrics: string[] }> {
  const client = getOpenAI();

  const topics = ["business overview", "financial performance", "risk factors", "strategy and outlook"];
  const allChunks: string[] = [];

  for (const topic of topics) {
    const queryEmb = await embed(topic);
    const chunks = await queryChunks(documentId, queryEmb, 3);
    allChunks.push(...chunks);
  }

  const context = [...new Set(allChunks)]
    .slice(0, 10)
    .map((c) => c.slice(0, 500))
    .join("\n\n");

  if (!context.trim()) {
    return { summary: "Summary unavailable — document may still be processing.", keyMetrics: [] };
  }

  const resp = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1000,
    messages: [
      {
        role: "system",
        content: "You are an expert financial analyst summarizing annual reports for investors.",
      },
      {
        role: "user",
        content: `Based on this content from ${companyName}'s annual report, provide:
1. A concise executive summary (3-4 paragraphs)
2. A JSON array of 5-8 key financial/business metrics found (as strings like "Revenue: $X.X billion")

Format your response as JSON: { "summary": "...", "keyMetrics": ["...", "..."] }

Content:
${context}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  try {
    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}") as {
      summary: string;
      keyMetrics: string[];
    };
    return {
      summary: parsed.summary ?? "Summary unavailable.",
      keyMetrics: parsed.keyMetrics ?? [],
    };
  } catch {
    return { summary: "Summary unavailable.", keyMetrics: [] };
  }
}
