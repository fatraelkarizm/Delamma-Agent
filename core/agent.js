import OpenAI from "openai";
import { buildSystemPrompt } from "./prompt.js";
import { executeTool } from "../tools/executor.js";
import { tools } from "../tools/definitions.js";
import { getWalletBalances } from "../tools/wallet.js";
import { getMyPositions } from "../tools/dlmm.js";
import { log } from "../integrations/logger.js";
import { config } from "./config.js";
import { getStateSummary } from "../storage/state.js";
import { getLessonsForPrompt, getPerformanceSummary } from "../storage/lessons.js";

const MANAGER_TOOLS = new Set(["close_position", "claim_fees", "swap_token", "update_config", "get_position_pnl", "get_my_positions", "set_position_note", "add_pool_note", "get_wallet_balance"]);
const SCREENER_TOOLS = new Set(["deploy_position", "get_active_bin", "get_top_candidates", "check_smart_wallets_on_pool", "get_token_holders", "get_token_narrative", "get_token_info", "search_pools", "get_pool_memory", "add_pool_note", "add_to_blacklist", "update_config", "get_wallet_balance", "get_my_positions"]);

function getToolsForRole(agentType) {
  if (agentType === "MANAGER") return tools.filter((t) => MANAGER_TOOLS.has(t.function.name));
  if (agentType === "SCREENER") return tools.filter((t) => SCREENER_TOOLS.has(t.function.name));
  return tools;
}

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY,
  timeout: 5 * 60 * 1000,
});

const DEFAULT_MODEL = process.env.LLM_MODEL || "openrouter/healer-alpha";

export async function agentLoop(goal, maxSteps = config.llm.maxSteps, sessionHistory = [], agentType = "GENERAL", model = null, maxOutputTokens = null) {
  const [portfolio, positions] = await Promise.all([getWalletBalances(), getMyPositions()]);
  const stateSummary = getStateSummary();
  const lessons = getLessonsForPrompt({ agentType });
  const perfSummary = getPerformanceSummary();
  const systemPrompt = buildSystemPrompt(agentType, portfolio, positions, stateSummary, lessons, perfSummary);

  const messages = [
    { role: "system", content: systemPrompt },
    ...sessionHistory,
    { role: "user", content: goal },
  ];

  for (let step = 0; step < maxSteps; step += 1) {
    log("agent", `Step ${step + 1}/${maxSteps}`);

    try {
      const activeModel = model || DEFAULT_MODEL;
      const FALLBACK_MODEL = "stepfun/step-3.5-flash:free";
      let response;
      let usedModel = activeModel;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await client.chat.completions.create({
          model: usedModel,
          messages,
          tools: getToolsForRole(agentType),
          tool_choice: "auto",
          temperature: config.llm.temperature,
          max_tokens: maxOutputTokens ?? config.llm.maxTokens,
        });

        if (response.choices?.length) break;

        const errCode = response.error?.code;
        if (errCode === 502 || errCode === 503 || errCode === 529) {
          const waitMs = (attempt + 1) * 5000;
          if (attempt === 1 && usedModel !== FALLBACK_MODEL) {
            usedModel = FALLBACK_MODEL;
            log("agent", `Switching to fallback model ${FALLBACK_MODEL}`);
          } else {
            log("agent", `Provider error ${errCode}, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/3)`);
            await sleep(waitMs);
          }
        } else {
          break;
        }
      }

      if (!response?.choices?.length) {
        log("error", `Bad API response: ${JSON.stringify(response).slice(0, 200)}`);
        throw new Error(`API returned no choices: ${response?.error?.message || "unknown"}`);
      }

      const msg = response.choices[0].message;
      messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        if (!msg.content) {
          messages.pop();
          log("agent", "Empty response, retrying...");
          continue;
        }
        return { content: msg.content, userMessage: goal };
      }

      const toolResults = await Promise.all(
        msg.tool_calls.map(async (toolCall) => {
          let functionArgs = {};
          try {
            functionArgs = JSON.parse(toolCall.function.arguments);
          } catch (parseError) {
            log("error", `Failed to parse args for ${toolCall.function.name}: ${parseError.message}`);
          }

          const result = await executeTool(toolCall.function.name, functionArgs);
          return {
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          };
        })
      );

      messages.push(...toolResults);
    } catch (error) {
      log("error", `Agent loop error at step ${step}: ${error.message}`);
      if (error.status === 429) {
        log("agent", "Rate limited, waiting 30s...");
        await sleep(30000);
        continue;
      }
      throw error;
    }
  }

  return { content: "Max steps reached. Review logs for partial progress.", userMessage: goal };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
