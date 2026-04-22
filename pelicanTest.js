/**
 * test_svg_generation.js
 * Test script for generating SVGs using multiple OpenRouter models.
 */
import OpenRouterClient from './OpenRouterClient.js';
import dotenv from 'dotenv';
import ora from 'ora';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { firefox } from 'playwright';

dotenv.config({ quiet: true });

// Models to test
const MODELS = [
    'qwen/qwen3.5-plus-02-15',
    'z-ai/glm-5',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
    'moonshotai/kimi-k2.5',
    'minimax/minimax-m2.5',
    'google/gemini-3-pro-preview',
    'google/gemini-3-flash-preview',
    'anthropic/claude-sonnet-4.5',
    'anthropic/claude-haiku-4.5',
    'anthropic/claude-opus-4.5',
    'openai/gpt-5.2-codex',
    'deepseek/deepseek-v3.2',
    'openai/gpt-5.4-pro',
    'openai/gpt-5.4',
    'openai/gpt-5.2',
    'openai/gpt-5-mini',
    'openai/gpt-5-nano',
    'openai/gpt-5.4-mini',
    'openai/gpt-5.4-nano',
    'openai/gpt-4.1',
    'openrouter/hunter-alpha',
    'openrouter/healer-alpha',
    'xiaomi/mimo-v2-pro',
    'minimax/minimax-m2.7',
    'x-ai/grok-4.20',
    'kwaipilot/kat-coder-pro-v2',
    'z-ai/glm-5.1',
    'openrouter/elephant-alpha',
    'moonshotai/kimi-k2.6',
    'xiaomi/mimo-v2.5',
    'xiaomi/mimo-v2.5-pro',
];

// Ensure output directory exists
const OUTPUT_DIR = path.join(process.cwd(), 'svg_outputs');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const COSTS_FILE = path.join(OUTPUT_DIR, 'costs.json');

// Handle Ctrl+C gracefully
let currentSpinner = null;
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

process.on('SIGINT', () => {
    if (currentSpinner) {
        currentSpinner.stop();
    }
    console.log(chalk.yellow('\n\n👋 Test interrupted by user. Goodbye!'));
    rl.close();
    process.exit(0);
});

async function runTest() {
    console.log(chalk.bold.blue('🎨 SVG GENERATION TEST STARTING 🎨'));
    console.log(chalk.gray('Output directory: ' + OUTPUT_DIR));
    console.log(chalk.gray('Costs file: ' + COSTS_FILE));

    const client = new OpenRouterClient();

    // Load existing costs
    let costs = {};
    if (fs.existsSync(COSTS_FILE)) {
        try {
            costs = JSON.parse(fs.readFileSync(COSTS_FILE, 'utf8'));
        } catch (e) {
            console.error(chalk.red('Error reading costs file, starting fresh.'));
        }
    }

    // Table header
    console.log('\n' + chalk.bold.white('Processing models...'));

    for (const model of MODELS) {
        // Construct filename to check for existence
        const filename = `${model.replace(/\//g, '_').replace(/[:.]/g, '-')}.svg`;
        const filepath = path.join(OUTPUT_DIR, filename);

        // Log file is used for backfilling cost if needed
        const logFile = path.join(OUTPUT_DIR, `svg_test_${model.replace(/\//g, '_')}.log`);

        // Check if SVG exists
        if (fs.existsSync(filepath)) {
            // Access existing cost
            let cost = costs[model];

            // If cost is missing but file exists, try to recover from log
            if (cost === undefined && fs.existsSync(logFile)) {
                try {
                    const logContent = fs.readFileSync(logFile, 'utf8');
                    const lines = logContent.split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const event = JSON.parse(line);
                            if (event.type === 'response.completed' && event.response && event.response.usage) {
                                cost = event.response.usage.cost || 0;
                                // Update costs immediately
                                costs[model] = cost;
                                fs.writeFileSync(COSTS_FILE, JSON.stringify(costs, null, 2));
                                break;
                            }
                        } catch (e) { /* ignore parse errors in log */ }
                    }
                } catch (e) {
                    console.error(chalk.gray(`Failed to parse log for ${model}: ${e.message}`));
                }
            }

            if (cost !== undefined) {
                console.log(chalk.gray(`Skipping ${model} (File exists) - Cost: $${cost.toFixed(6)}`));
            } else {
                console.log(chalk.gray(`Skipping ${model} (File exists) - Cost: Unknown`));
            }
            continue;
        }

        // SVG does not exist, so we generate
        // Use a spinner for each model
        currentSpinner = ora({
            text: chalk.yellow(`Testing model: ${model}...`),
            spinner: 'dots'
        }).start();

        try {
            const prompt = "send svg of a pelican riding a bicycle";

            // Using messages array format
            const messages = [{ role: 'user', content: prompt }];

            // Note on logFile: OpenRouterClient accepts a filename (relative or absolute).
            // We pass the absolute path we constructed above.
            const response = await client.complete(null, messages, model, 12000, undefined, logFile);

            if (!response || !response.usage) {
                // If complete() returns empty without error
                throw new Error('No response or usage data returned');
            }

            const cost = response.usage.cost || 0;
            costs[model] = cost;
            fs.writeFileSync(COSTS_FILE, JSON.stringify(costs, null, 2));

            // Extract SVG
            let svgContent = response.text;

            // Simple extraction logic: look for <svg ... </svg>
            const svgMatch = svgContent.match(/<svg[\s\S]*?<\/svg>/i);

            if (svgMatch) {
                svgContent = svgMatch[0];
                fs.writeFileSync(filepath, svgContent);
                currentSpinner.succeed(chalk.green(`Model ${model} completed. Cost: $${cost.toFixed(6)}`));
                console.log(chalk.gray(`   Saved to: ${filename}`));
            } else {
                currentSpinner.fail(chalk.red(`Model ${model} completed but NO SVG FOUND. Cost: $${cost.toFixed(6)}`));
                // Save raw text for debugging
                const failFile = `${model.replace(/\//g, '_')}_FAILED.txt`;
                fs.writeFileSync(path.join(OUTPUT_DIR, failFile), response.text || '');
                console.log(chalk.gray(`   Raw output saved to: ${failFile}`));
                console.log(chalk.gray(`   Response length: ${response.text ? response.text.length : 0} characters`));
                if (response.text && response.text.length > 0) {
                    console.log(chalk.gray(`   Preview: ${response.text.substring(0, 200).replace(/\n/g, ' ')}...`));
                } else {
                    console.log(chalk.red(`   Response was empty/whitespace.`));
                }
            }

        } catch (error) {
            if (currentSpinner) {
                currentSpinner.fail(chalk.red(`Model ${model} failed: ${error.message}`));
            }
            // We usually don't save failure costs to 0 unless we want to, 
            // but user said "only deleted svgs get rendered and their cost updated".
            // If it fails, we assume we might retry later, so maybe don't write to costs.json or write null?
            // For now, let's just not write to costs.json so it retries next time.
        }
        currentSpinner = null;
    }

    // Final Cost Table
    console.log('\n' + chalk.bold.blue('═'.repeat(60)));
    console.log(chalk.bold.yellow('💰 FINAL COST TABLE 💰'));
    console.log(chalk.bold.blue('═'.repeat(60)));
    console.log(chalk.bold.white(pad('Model', 40)) + chalk.bold.white('Cost ($)'));
    console.log(chalk.gray('─'.repeat(60)));

    let totalCost = 0;

    // Iterate over MODELS to maintain order, but pull from costs object
    for (const model of MODELS) {
        const cost = costs[model];
        let costDisplay;

        if (cost !== undefined) {
            costDisplay = chalk.green('$' + cost.toFixed(6));
            totalCost += cost;
        } else {
            // If we missed it (failed run, or file exists but log missing)
            // Check if file exists to decide status
            const filename = `${model.replace(/\//g, '_').replace(/[:.]/g, '-')}.svg`;
            const filepath = path.join(OUTPUT_DIR, filename);

            if (fs.existsSync(filepath)) {
                costDisplay = chalk.yellow('Unknown (Cached)');
            } else {
                costDisplay = chalk.red('Not Generated');
            }
        }
        console.log(pad(model, 40) + costDisplay);
    }
    console.log(chalk.gray('─'.repeat(60)));
    console.log(pad(chalk.bold('TOTAL RECORDED'), 40) + chalk.bold.green('$' + totalCost.toFixed(6)));
    console.log(chalk.bold.blue('═'.repeat(60)) + '\n');

    await generateOverview(costs);
    rl.close();
    process.exit(0);
}

async function generateOverview(costs) {
    console.log(chalk.blue('📸 Generating overview screenshot...'));

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: sans-serif; background: #f0f0f0; padding: 20px; }
            h1 { text-align: center; color: #333; }
            .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
            .card { background: white; padding: 10px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); text-align: center; }
            .card img { max-width: 100%; height: auto; border: 1px solid #eee; border-radius: 4px; }
            .model-name { font-weight: bold; margin-top: 10px; font-size: 0.9em; color: #555; word-break: break-all; }
            .cost { color: #2e7d32; font-weight: bold; margin-top: 5px; }
            .error { color: #d32f2f; }
        </style>
    </head>
    <body>
        <h1>SVG Generation Overview</h1>
        <div class="grid">
            ${MODELS.map(model => {
        const filename = `${model.replace(/\//g, '_').replace(/[:.]/g, '-')}.svg`;
        const cost = costs[model];
        const costStr = cost !== undefined ? '$' + cost.toFixed(6) : 'N/A';
        const fileExists = fs.existsSync(path.join(OUTPUT_DIR, filename));

        return `
                <div class="card">
                    ${fileExists ? `<img src="${filename}" alt="${model}">` : '<div style="height:200px;display:flex;align-items:center;justify-content:center;background:#eee;color:#999">No Image</div>'}
                    <div class="model-name">${model}</div>
                    <div class="cost ${cost === undefined ? 'error' : ''}">${costStr}</div>
                </div>
                `;
    }).join('')}
        </div>
    </body>
    </html>
    `;

    const htmlPath = path.join(OUTPUT_DIR, 'overview.html');
    fs.writeFileSync(htmlPath, htmlContent);
    console.log(chalk.gray(`   HTML generated at: ${htmlPath}`));

    try {
        const browser = await firefox.launch();
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1200, height: 800 });
        await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle' });

        const screenshotPath = path.join(OUTPUT_DIR, 'overview.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });

        console.log(chalk.green(`   Screenshot saved to: ${screenshotPath}`));
        await browser.close();
    } catch (e) {
        console.error(chalk.red(`   Failed to generate screenshot: ${e.message}`));
    }
}

function pad(str, len) {
    // Remove ANSI codes for length calculation
    const stripped = str.replace(/\u001b\[\d+m/g, '');
    if (stripped.length >= len) return str + ' ';
    return str + ' '.repeat(len - stripped.length);
}

runTest();
