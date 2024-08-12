import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
// import { createClient } from 'jsr:@supabase/supabase-js@2'
import { codeBlock, oneLine } from "common-tags";
import GPT3Tokenizer from "gpt3-tokenizer";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { ApplicationError, UserError } from "@/lib/errors";
import { OpenAI } from "openai";
import ollama from "ollama";

const openAiKey = process.env.OPENAI_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiLlamaCppUrl = process.env.OPENAI_LLAMA_CPP_URL;
const openaiOllamaUrl = process.env.OPENAI_OLLAMA_URL;

const openai = new OpenAI({
  apiKey: openAiKey,
  baseURL: openaiLlamaCppUrl,
});

export const runtime = "edge";

export default async function handler(req: NextRequest) {
  try {
    if (!openAiKey) {
      throw new ApplicationError("Missing environment variable OPENAI_KEY");
    }

    if (!supabaseUrl) {
      throw new ApplicationError("Missing environment variable SUPABASE_URL");
    }

    if (!supabaseServiceKey) {
      throw new ApplicationError(
        "Missing environment variable NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
    }

    const requestData = await req.json();

    if (!requestData) {
      throw new UserError("Missing request data");
    }

    const { prompt: query } = requestData;

    if (!query) {
      throw new UserError("Missing query in request data");
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    // Moderate the content to comply with OpenAI T&C
    // const sanitizedQuery = query.trim().replace(/[\r\n]+/g, " ");
    const sanitizedQuery = query.trim().replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, ' & ');
    console.log(`sanitizedQuery: ${sanitizedQuery}`);

    // const embeddingResponse = await openai.embeddings.create({
    //   model: 'llama2',
    //   input: sanitizedQuery,
    // })

    // const [responseData] = embeddingResponse.data
    // console.log(`responseData: ${JSON.stringify(responseData.embedding)}`)

    // console.log(`embedding: ${embedding}`)

    const embeddingResponse = await ollama.embeddings({
      model: "nomic-embed-text:latest",
      prompt: sanitizedQuery,
    });

    // console.log(`embeddingResponse: ${JSON.stringify(embeddingResponse)}`)
    // console.log(`embedding length: ${embeddingResponse.embedding.length}`);

    const { error: matchError, data: pageSections } = await supabaseClient.rpc(
      "hybrid_search",
      // 'pgvector_hybrid_search',
      // 'match_page_sections',
      {
        query_text: sanitizedQuery,
        query_embedding: embeddingResponse.embedding,
        match_count: 10,
      },
    );

    // const { error: matchError, data: pageSections } = await supabaseClient.rpc(
    //   'match_page_sections',
    //   {
    //     embedding: responseData.embedding,
    //     match_threshold: 0.2,
    //     match_count: 10,
    //     min_content_length: 50,
    //   }
    // )

    // console.log(`pageSections: ${JSON.stringify(pageSections)}`);

    if (matchError) {
      throw new ApplicationError("Failed to match page sections", matchError);
    }

    // // Direct database query for debugging
    // const { data: debugData, error: debugError } = await supabaseClient
    //   .from("nodes_page_section")
    //   .select("*")
    //   .limit(10);

    // if (debugError) {
    //   console.error(`debugError: ${debugError.message}`);
    // } else {
    //   console.log(`debugData: ${JSON.stringify(debugData)}`);
    // }

    const tokenizer = new GPT3Tokenizer({ type: "gpt3" });
    let tokenCount = 0;
    let contextText = "";

    for (let i = 0; i < pageSections.length; i++) {
      const pageSection = pageSections[i];
      const content = pageSection.content;
      const encoded = tokenizer.encode(content);
      tokenCount += encoded.text.length;

      if (tokenCount >= 1500) {
        break;
      }

      contextText += `${content.trim()}\n---\n`;
    }

    console.log(`contextText: ${contextText}`);
    console.log(`sanitizedQuery: ${sanitizedQuery}`);

    const prompt = codeBlock`
      ${oneLine`
        You're an AI assistant who answers questions about documents and related code snippets.
      
        You're a chat bot, so keep your replies succinct and conversational. 
        
        Don't repeat the question in your answer.

        Don't repeat the prompt in your answer.

        You're only allowed to use the documents below to answer the question.

        If the question isn't related to these documents, say:
        "Sorry, I couldn't find any information from the documents."

        If the information isn't available in below documents, say:
        "Sorry, I couldn't find any information from the documents."

        Do not go off topic.
      `}

      Documents:
      ${contextText}

      Question: """
      ${query}
      """

      Answer as markdown (including related code snippets if available):
    `;

    const chatMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = {
      role: "user",
      content: prompt,
    };

    // baseURL: 'http://10.128.138.175:8000/v1/',
    // baseURL: 'http://10.128.138.175:11434/v1/',
    // baseURL: "http://host.docker.internal:11434/v1/",

    const openai_ollama = new OpenAI({
      apiKey: openAiKey,
      baseURL: openaiOllamaUrl,
    });

    const response = await openai_ollama.chat.completions.create({
      model: "llama3.1",
      messages: [chatMessage],
      max_tokens: 512,
      temperature: 0,
      stream: true,
    });

    // if (!response.ok) {
    //   const error = await response.json()
    //   throw new ApplicationError('Failed to generate completion', error)
    // }

    // Transform the response into a readable stream
    const stream = OpenAIStream(response);
    // console.log(`stream: ${stream}`);

    // Return a StreamingTextResponse, which can be consumed by the client
    return new StreamingTextResponse(stream);
  } catch (err: unknown) {
    if (err instanceof UserError) {
      return new Response(
        JSON.stringify({
          error: err.message,
          data: err.data,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    } else if (err instanceof ApplicationError) {
      // Print out application errors with their additional data
      console.error(`${err.message}: ${JSON.stringify(err.data)}`);
    } else {
      // Print out unexpected errors as is to help with debugging
      console.error(err);
    }

    // TODO: include more response info in debug environments
    return new Response(
      JSON.stringify({
        error: "There was an error processing your request",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
