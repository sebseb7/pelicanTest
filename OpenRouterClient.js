/**
 * OpenRouterClient.js
 * Wrapper for @openrouter/sdk to handle streaming responses and debugging.
 */
import { OpenRouter } from '@openrouter/sdk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ quiet: true });

// Log file path


class OpenRouterClient {
    constructor(apiKey = process.env.OPENROUTER_API_KEY) {
        if (!apiKey) {
            throw new Error('OPENROUTER_API_KEY is required');
        }
        this.client = new OpenRouter({ apiKey });
    }

    /**
     * Completes a prompt using the specified model and streams the response.
     * @param {string} prompt - The input text for the model.
     * @param {string} model - The model identifier (default: 'openai/gpt-oss-120b:free').
     * @param {number} [max_tokens] - Optional maximum number of tokens to generate.
     * @param {object} [format] - Optional response format configuration (json_schema type).
     * @returns {Promise<object>} - The full response text, parsed JSON (if applicable), and usage.
     */
    async complete(instruct, prompt, model = 'openai/gpt-oss-120b:free', max_tokens = undefined, format = undefined, logFilename = 'openrouter-events.log', previousResponseId = null) {
        // Build request parameters
        const requestParams = {
            model: model,
            input: prompt,
            maxOutputTokens: max_tokens,
            provider: { require_parameters: true },
            previousResponseId: previousResponseId
        };

        // Add text format if provided (for structured output)
        if (format) {
            requestParams.text = { format };
        }

        //console.log('callmodel:' + JSON.stringify(requestParams, null, 2));

        const result = await this.client.callModel(requestParams);

        let usage = null;
        let output = null;

        const logPath = path.isAbsolute(logFilename) ? logFilename : path.join(process.cwd(), logFilename);
        for await (const event of result.getFullResponsesStream()) {
            fs.appendFileSync(logPath, JSON.stringify(event, null, 2) + '\n');
            switch (event.type) {
                case 'response.output_text.delta':
                    //process.stdout.write(event.delta);
                    break;
                case 'response.content_part.added':
                    //process.stdout.write("\n" + event.part.type + "\n");
                    break;
                case 'response.reasoning_text.delta':
                    //process.stdout.write(event.delta);
                    break;
                case 'response.completed':
                    if (event.response && event.response.usage) {
                        usage = event.response.usage;
                    }
                    if (event.response && event.response.output) {
                        output = event.response.output;
                    }
                    break;
                default:
            }
        }

        if (!output) {
            console.error('No output received from model');
            return {
                usage: usage,
                output: null,
                text: ''
            };
        }

        const text = output
            .filter(item => item.role === 'assistant' && item.content)
            .flatMap(item => item.content)
            .filter(contentItem => contentItem.type === 'output_text')
            .map(contentItem => contentItem.text)
            .join('');

        // Try to parse as JSON if format was specified or if text looks like JSON
        let json = null;
        if (text) {
            const trimmedText = text.trim();
            if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
                try {
                    json = JSON.parse(trimmedText);
                } catch (e) {
                    // Not valid JSON, that's okay
                }
            }
        }

        return {
            usage: usage,
            output: output,
            text: text,
            json: json
        };
    }
}

export default OpenRouterClient;
