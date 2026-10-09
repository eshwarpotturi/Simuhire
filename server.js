import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import cron from 'node-cron';
import nodemailer from 'nodemailer';

const app = express();
const port = process.env.PORT || 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, 'data.json');

// --- Data Persistence ---
let appData = {
    simulations: {},
    reports: {},
    templates: {}
};

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            appData = JSON.parse(data);
        }
    } catch (err) {
        console.error("Failed to load data:", err);
    }
}

function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(appData, null, 2));
    } catch (err) {
        console.error("Failed to save data:", err);
    }
}

loadData();

// --- Email Notification Logic ---
async function sendDailyReport() {
    const recipient = process.env.REPORT_RECIPIENT || "eswar@simuhire.online";
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!smtpHost || !smtpUser || !smtpPass) {
        console.warn("SMTP configuration missing. Skipping daily report email.");
        return;
    }

    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort || '587'),
        secure: smtpPort === '465',
        auth: {
            user: smtpUser,
            pass: smtpPass,
        },
    });

    // Group reports by simulation ID
    const reportSummary = {};
    Object.values(appData.reports).forEach(report => {
        if (!reportSummary[report.simulationId]) {
            reportSummary[report.simulationId] = [];
        }
        reportSummary[report.simulationId].push(report);
    });

    let emailHtml = `
        <h1 style="color: #2563eb;">SimuHire Periodic Report</h1>
        <p>Generated on: ${new Date().toLocaleString()}</p>
    `;

    if (Object.keys(reportSummary).length === 0) {
        emailHtml += "<p>No simulations have been completed yet.</p>";
    } else {
        for (const [simId, reports] of Object.entries(reportSummary)) {
            const sim = appData.simulations[simId];
            emailHtml += `
                <div style="margin-bottom: 30px; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #1e293b; margin-top: 0;">Simulation: ${sim ? sim.jobTitle : simId}</h2>
                    <p><strong>ID:</strong> ${simId}</p>
                    <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        <thead>
                            <tr style="background-color: #f8fafc;">
                                <th style="border: 1px solid #e2e8f0; padding: 8px; text-align: left;">Candidate Name</th>
                                <th style="border: 1px solid #e2e8f0; padding: 8px; text-align: left;">Email</th>
                                <th style="border: 1px solid #e2e8f0; padding: 8px; text-align: left;">Suitability Score</th>
                                <th style="border: 1px solid #e2e8f0; padding: 8px; text-align: left;">Recommendation</th>
                                <th style="border: 1px solid #e2e8f0; padding: 8px; text-align: left;">Completed At</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            reports.forEach(report => {
                emailHtml += `
                    <tr>
                        <td style="border: 1px solid #e2e8f0; padding: 8px;">${report.candidateName}</td>
                        <td style="border: 1px solid #e2e8f0; padding: 8px;">${report.candidateEmail}</td>
                        <td style="border: 1px solid #e2e8f0; padding: 8px;">${report.suitabilityScore}/10</td>
                        <td style="border: 1px solid #e2e8f0; padding: 8px;">${report.recommendation}</td>
                        <td style="border: 1px solid #e2e8f0; padding: 8px;">${new Date(report.completedAt).toLocaleString()}</td>
                    </tr>
                `;
            });

            emailHtml += `
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    try {
        await transporter.sendMail({
            from: `"SimuHire" <${process.env.MAIL_FROM || smtpUser}>`,
            to: recipient,
            subject: `SimuHire Periodic Report - ${new Date().toLocaleString()}`,
            html: emailHtml,
        });
        console.log("Periodic report email sent successfully to", recipient);
    } catch (err) {
        console.error("Failed to send periodic report email:", err);
    }
}

// Schedule the task for every 10 minutes
// Cron format: minute hour day-of-month month day-of-week
cron.schedule('*/10 * * * *', () => {
    console.log("Running scheduled periodic report task...");
    sendDailyReport();
});

// --- Middleware ---
app.use(express.json({ limit: '50mb' })); // Increase limit for file uploads

// Vite middleware for development
if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
    });
    app.use(vite.middlewares);
} else {
    app.use(express.static(path.join(__dirname, 'dist')));
}

// --- Claude configuration ---
// Fast model for task design and live conversations; stronger model for the final evaluation.
// Both can be overridden with environment variables.
const FAST_MODEL = process.env.CLAUDE_FAST_MODEL || 'claude-haiku-5-5';
const ANALYSIS_MODEL = process.env.CLAUDE_ANALYSIS_MODEL || 'claude-sonnet-5-5';

// Image formats Claude can read directly, and the per-image size limit we enforce before sending.
const CLAUDE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// --- JSON Schemas for structured responses ---
const TASK_TYPES = ['TEXT', 'IMAGE', 'AUDIO', 'VIDEO'];

const assetSchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['infographic', 'email_thread', 'spreadsheet_data', 'document'] },
    title: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['type', 'content'],
};

const singleTaskSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    asset: assetSchema,
    type: { type: 'string', enum: TASK_TYPES },
  },
  required: ['title', 'description', 'type'],
};

// Claude returns structured data as a tool input, which must be an object, so lists are wrapped.
const taskListSchema = {
  type: 'object',
  properties: {
    tasks: { type: 'array', items: singleTaskSchema },
  },
  required: ['tasks'],
};

const groupsSchema = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          taskIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'taskIds'],
      },
    },
  },
  required: ['groups'],
};

const analysisSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    areasForImprovement: { type: 'array', items: { type: 'string' } },
    stressManagementScore: { type: 'integer', minimum: 1, maximum: 10 },
    communicationScore: { type: 'integer', minimum: 1, maximum: 10 },
    problemSolvingScore: { type: 'integer', minimum: 1, maximum: 10 },
    recommendation: { type: 'string', enum: ['HIRE', 'CONSIDER', 'NO_HIRE'] },
    suitabilityScore: { type: 'integer', minimum: 1, maximum: 10 },
    recommendationReasoning: { type: 'string' },
  },
  required: [
    'summary', 'strengths', 'areasForImprovement', 'stressManagementScore', 'communicationScore', 'problemSolvingScore',
    'recommendation', 'suitabilityScore', 'recommendationReasoning',
  ],
};

// --- API Endpoints ---

app.get('/api/data', (req, res) => {
    res.json(appData);
});

app.post('/api/simulations', (req, res) => {
    const simulation = req.body;
    if (!simulation || !simulation.id) {
        return res.status(400).json({ error: "Invalid simulation data" });
    }
    appData.simulations[simulation.id] = simulation;
    saveData();
    res.json({ success: true });
});

app.post('/api/reports', (req, res) => {
    const { key, report } = req.body;
    if (!key || !report) {
        return res.status(400).json({ error: "Invalid report data" });
    }
    appData.reports[key] = report;
    saveData();
    res.json({ success: true });
});

app.post('/api/templates', (req, res) => {
    const template = req.body;
    if (!template || !template.id) {
        return res.status(400).json({ error: "Invalid template data" });
    }
    appData.templates[template.id] = template;
    saveData();
    res.json({ success: true });
});

app.delete('/api/templates/:id', (req, res) => {
    const { id } = req.params;
    if (appData.templates[id]) {
        delete appData.templates[id];
        saveData();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: "Template not found" });
    }
});

// --- Claude helpers ---

const CONFIG_ERROR = {
    error: "Configuration Error: The 'ANTHROPIC_API_KEY' environment variable is missing on the server. Please check your hosting environment settings and ensure a variable named 'ANTHROPIC_API_KEY' is set with a valid Claude API key."
};

let anthropicClient = null;
function getClaude() {
    if (!process.env.ANTHROPIC_API_KEY) return null;
    if (!anthropicClient) {
        anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    }
    return anthropicClient;
}

// Ask Claude for a response that matches a JSON Schema. The schema is supplied as the input
// schema of a single tool that Claude is required to call, so the result is always structured.
async function claudeJson(claude, { model, content, schema, toolName, toolDescription, maxTokens = 4096 }) {
    const response = await claude.messages.create({
        model,
        max_tokens: maxTokens,
        tools: [{ name: toolName, description: toolDescription, input_schema: schema }],
        tool_choice: { type: 'tool', name: toolName },
        messages: [{ role: 'user', content }],
    });

    if (response.stop_reason === 'max_tokens') {
        throw new Error("The AI response was cut off before it was complete.");
    }
    const toolUse = response.content.find(block => block.type === 'tool_use');
    if (!toolUse) {
        throw new Error("AI service returned no structured response.");
    }
    return toolUse.input;
}

// Ask Claude for a plain text reply.
async function claudeText(claude, { model, system, messages, maxTokens = 1024 }) {
    const response = await claude.messages.create({
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages,
    });
    const text = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
        .trim();
    if (!text) {
        throw new Error("AI service returned an empty response.");
    }
    return text;
}

// Convert a UI chat history into Claude's alternating message format. Claude conversations must
// open with a user turn, so if the history opens with the AI, `openingUserTurn` is placed first.
function toClaudeMessages(entries, openingUserTurn) {
    const messages = [];
    for (const { role, text } of entries) {
        if (!text || !text.trim()) continue;
        const last = messages[messages.length - 1];
        if (last && last.role === role) {
            last.content += `\n\n${text}`;
        } else {
            messages.push({ role, content: text });
        }
    }
    if (messages.length === 0 || messages[0].role !== 'user') {
        messages.unshift({ role: 'user', content: openingUserTurn });
    }
    // Claude replies to the latest user turn, so the history must not end on the AI's own message.
    if (messages[messages.length - 1].role !== 'user') {
        messages.push({ role: 'user', content: '(No reply yet.)' });
    }
    return messages;
}

// Wraps an endpoint that returns structured JSON.
async function handleJsonCall(res, label, run) {
    const claude = getClaude();
    if (!claude) {
        return res.status(500).json(CONFIG_ERROR);
    }
    try {
        res.json(await run(claude));
    } catch (error) {
        console.error(`Claude API call failed in ${label}:`, error);
        res.status(500).json({ error: "An error occurred while communicating with the AI service." });
    }
}

// Wraps an endpoint that returns plain text as { text }.
async function handleTextCall(res, label, run) {
    await handleJsonCall(res, label, async (claude) => ({ text: await run(claude) }));
}

const withIds = (tasks) => tasks.map((task, index) => ({
    ...task,
    id: `task-${Date.now()}-${index}`,
}));


app.post('/api/generate-tasks', async (req, res) => {
    const { jobTitle, jobDescription } = req.body;
    const prompt = `Based on the following job role, generate 5 realistic and distinct tasks that a candidate would perform during a work simulation. The tasks should test a range of skills. Critically, you MUST include a variety of task types. The available types are 'TEXT', 'IMAGE', 'AUDIO', and 'VIDEO'.
- A 'TEXT' task requires a written response.
- An 'IMAGE' task requires the candidate to upload a picture (e.g., a design mockup, a screenshot).
- An 'AUDIO' task requires an audio file upload (e.g., a recorded voice memo summary).
- A 'VIDEO' task requires a video file upload (e.g., a short screen recording or presentation).
Make the task descriptions clearly state what kind of submission is expected.

Each task must have a "title", a "description", and a "type" ('TEXT', 'IMAGE', 'AUDIO', or 'VIDEO').

**CRITICAL REQUIREMENT:** If a task requires the candidate to analyze an external document (like an infographic, email, dataset, or memo), you **MUST** create and embed that document's content directly within the task object under an \`asset\` field. The \`asset\` object must have:
1. \`type\`: one of 'infographic', 'email_thread', 'spreadsheet_data', 'document'.
2. \`title\`: a short title for the asset (e.g., "Q3 Marketing Report").
3. \`content\`: a detailed, text-based representation of the asset. For an infographic, describe its key data points. For an email, write out the full email. For spreadsheet data, use markdown table format.

Job Title: ${jobTitle}
Job Description: ${jobDescription}`;

    await handleJsonCall(res, '/api/generate-tasks', async (claude) => {
        const { tasks } = await claudeJson(claude, {
            model: FAST_MODEL,
            content: prompt,
            schema: taskListSchema,
            toolName: 'save_simulation_tasks',
            toolDescription: 'Save the generated list of work-simulation tasks.',
            maxTokens: 8192,
        });
        return withIds(tasks);
    });
});

app.post('/api/modify-tasks', async (req, res) => {
    const { jobTitle, jobDescription, currentTasks, modification } = req.body;
    const prompt = `You are an assistant helping a recruiter refine a work simulation.\n\nJob Title: ${jobTitle}\nJob Description: ${jobDescription}\n\nHere is the current list of tasks for the simulation:\n${JSON.stringify(currentTasks, null, 2)}\n\nThe recruiter has requested the following modification: "${modification}"\n\nPlease generate and return a new, complete list of tasks that incorporates this change. Each task has a "title", "description", and a "type" ('TEXT', 'IMAGE', 'AUDIO', or 'VIDEO'). Make the description clearly state the expected submission type. If a task requires an asset (like an email or document), you MUST include it in an 'asset' object as per the schema.`;

    await handleJsonCall(res, '/api/modify-tasks', async (claude) => {
        const { tasks } = await claudeJson(claude, {
            model: FAST_MODEL,
            content: prompt,
            schema: taskListSchema,
            toolName: 'save_simulation_tasks',
            toolDescription: 'Save the complete, updated list of work-simulation tasks.',
            maxTokens: 8192,
        });
        return withIds(tasks);
    });
});

app.post('/api/regenerate-single-task', async (req, res) => {
    const { jobTitle, jobDescription, allTasks, taskToChange, instruction } = req.body;
    const otherTasks = allTasks.filter(t => t.id !== taskToChange.id);
    const prompt = `You are an assistant helping a recruiter refine a single task within a work simulation.\n\nJob Title: ${jobTitle}\nJob Description: ${jobDescription}\n\nHere is the full list of existing tasks, for context, to avoid creating a duplicate:\n${JSON.stringify(otherTasks, null, 2)}\n\nHere is the specific task to be changed:\n${JSON.stringify(taskToChange, null, 2)}\n\nThe recruiter's instruction for this task is: "${instruction}"\n\nPlease generate ONLY the single, updated task based on this instruction. If the updated task requires an asset (like an email or document), include it in an 'asset' object. The task has a "title", "description", and "type" ('TEXT', 'IMAGE', 'AUDIO', or 'VIDEO'). Make the description clear about what to submit.`;

    await handleJsonCall(res, '/api/regenerate-single-task', (claude) => claudeJson(claude, {
        model: FAST_MODEL,
        content: prompt,
        schema: singleTaskSchema,
        toolName: 'save_task',
        toolDescription: 'Save the single updated work-simulation task.',
    }));
});

app.post('/api/generate-single-task', async (req, res) => {
    const { jobTitle, jobDescription, existingTasks } = req.body;
    const prompt = `You are an assistant helping a recruiter create a work simulation.\n\nJob Title: ${jobTitle}\nJob Description: ${jobDescription}\n\nHere is the list of existing tasks. Please generate ONE new, distinct task that is not a repeat of the ones below:\n${JSON.stringify(existingTasks, null, 2)}\n\nThe new task has a "title", "description", and a "type" ('TEXT', 'IMAGE', 'AUDIO', or 'VIDEO'). The description must clearly explain the expected submission type. If the new task requires an asset (like an email or document), you MUST include it in an 'asset' object.`;

    await handleJsonCall(res, '/api/generate-single-task', (claude) => claudeJson(claude, {
        model: FAST_MODEL,
        content: prompt,
        schema: singleTaskSchema,
        toolName: 'save_task',
        toolDescription: 'Save the single new work-simulation task.',
    }));
});

app.post('/api/group-tasks', async (req, res) => {
    const tasks = req.body.tasks || [];
    // Claude only decides which task goes in which group. The full task objects are re-attached
    // here, so nothing a recruiter wrote (such as evaluation criteria) can be altered or dropped.
    const taskSummaries = tasks.map(({ id, title, description, type }) => ({ id, title, description, type }));
    const prompt = `You are an expert hiring manager tasked with organizing a job simulation. Analyze the following list of tasks. Group them into logical categories based on the primary skill each task evaluates (e.g., "Client Communication & Follow-up", "Data Analysis & Reporting", "Strategic Planning").

For each group, provide a concise, descriptive title and the list of task ids that belong to it. Every task from the input list must be placed into exactly one group.

Existing Tasks:
${JSON.stringify(taskSummaries, null, 2)}`;

    await handleJsonCall(res, '/api/group-tasks', async (claude) => {
        const { groups } = await claudeJson(claude, {
            model: FAST_MODEL,
            content: prompt,
            schema: groupsSchema,
            toolName: 'save_task_groups',
            toolDescription: 'Save the task groups, each with a title and the ids of its tasks.',
        });

        const tasksById = new Map(tasks.map(task => [task.id, task]));
        const result = [];
        for (const group of groups) {
            const groupTasks = [];
            for (const id of group.taskIds) {
                // Each task is used once, even if the model listed it in two groups.
                if (tasksById.has(id)) {
                    groupTasks.push(tasksById.get(id));
                    tasksById.delete(id);
                }
            }
            if (groupTasks.length > 0) {
                result.push({ title: group.title, tasks: groupTasks });
            }
        }
        // Any task the model left out still has to appear somewhere.
        if (tasksById.size > 0) {
            result.push({ title: 'Other', tasks: [...tasksById.values()] });
        }
        return result;
    });
});

app.post('/api/suggest-criteria', async (req, res) => {
    const { taskTitle, taskDescription } = req.body;
    const prompt = `You are an expert hiring manager. For a simulation task titled "${taskTitle}" with the description "${taskDescription}", suggest a concise, bullet-pointed list of evaluation criteria. This criteria will be used by an AI to score a candidate's response. Focus on 2-4 measurable outcomes. Start each point with a hyphen. Return only the bullet points, with no introduction.`;

    await handleTextCall(res, '/api/suggest-criteria', (claude) => claudeText(claude, {
        model: FAST_MODEL,
        messages: [{ role: 'user', content: prompt }],
    }));
});


app.post('/api/analyze-performance', async (req, res) => {
    const { simulation, work, behavioralData } = req.body;
    const allTasks = simulation.tasks || [];

    // Image submissions that Claude can inspect directly are attached after the written brief.
    const imageBlocks = [];

    const submittedTasksContent = allTasks
        .filter(task => work.taskAnswers && work.taskAnswers[task.id] !== undefined)
        .map(task => {
            const answer = work.taskAnswers[task.id];
            let answerContent = '';
            switch (answer.type) {
                case 'TEXT':
                    answerContent = `CANDIDATE'S SUBMITTED ANSWER (Text):\n"""\n${answer.content}\n"""`;
                    break;
                case 'IMAGE': {
                    const imageBytes = Math.floor(((answer.content || '').length * 3) / 4);
                    if (answer.content && CLAUDE_IMAGE_TYPES.has(answer.fileType) && imageBytes <= MAX_IMAGE_BYTES) {
                        imageBlocks.push(
                            { type: 'text', text: `Attached image submitted for the task "${task.title}" (file name: ${answer.fileName}):` },
                            { type: 'image', source: { type: 'base64', media_type: answer.fileType, data: answer.content } },
                        );
                        answerContent = `CANDIDATE'S SUBMISSION (IMAGE):\nFile Name: ${answer.fileName}\nFile Type: ${answer.fileType}\n(The image itself is attached at the end of this message. Inspect it and evaluate its actual content against the task.)`;
                        break;
                    }
                    answerContent = `CANDIDATE'S SUBMISSION (IMAGE):\nFile Name: ${answer.fileName}\nFile Type: ${answer.fileType}\n(NOTE: This image could not be attached, so you cannot see its contents. State this limitation and do not score its content.)`;
                    break;
                }
                case 'AUDIO':
                case 'VIDEO':
                    answerContent = `CANDIDATE'S SUBMISSION (${answer.type}):\nFile Name: ${answer.fileName}\nFile Type: ${answer.fileType}\n(NOTE: You cannot see or hear this file. You only know that a file of this type was uploaded.)`;
                    break;
                default:
                    answerContent = 'Unknown submission type.';
            }
            return `
---
TASK: "${task.title}"
DESCRIPTION: ${task.description}
${task.asset ? `PROVIDED ASSET ("${task.asset.title || 'Context'}"):\n"""\n${task.asset.content}\n"""` : ''}
EXPECTED SUBMISSION TYPE: ${task.type}
EVALUATION CRITERIA: ${task.evaluationCriteria || 'Evaluate based on clarity, accuracy, and relevance to the task.'}
${answerContent}
---
`}).join('\n');

    const prompt = `You are an expert hiring manager analyzing a candidate's performance in a work simulation for the role of "${simulation.jobTitle}". Your report supports a human recruiter, who makes the final hiring decision.

**CANDIDATE'S SUBMITTED WORK**
The candidate has provided the following submissions for their assigned tasks. Submissions can be text or file uploads (image, audio, video). Image submissions are attached to this message where possible, so you can inspect them. Audio and video files are not attached: for those you will only see the file name and type.

${submittedTasksContent.length > 0 ? submittedTasksContent : "The candidate did not submit answers for any tasks."}

**ADDITIONAL CONTEXT**
The following data should be used to evaluate broader skills like communication and adaptability:
- **AI Assistant Chat Log:** ${JSON.stringify(work.chatLogs)}
- **Client Call Transcript:** """${work.callTranscript}"""

**BEHAVIORAL DATA & EVENT LOG**
- **Time Taken:** ${behavioralData.timeTakenSeconds} seconds
- **Total Time Allotted:** ${behavioralData.totalDurationSeconds} seconds
- **Submission Type:** ${behavioralData.submissionReason === 'auto' ? 'Session automatically submitted due to timeout.' : 'Candidate submitted manually.'}
- **Event Log:** A log of the candidate's actions is provided below. Use this to analyze their behavior.
  ${JSON.stringify(work.eventLog || [])}

**EVALUATION INSTRUCTIONS**
1.  **Task-Specific Analysis:** For each submitted task, evaluate the candidate's work.
    - For 'TEXT' submissions, use the provided 'EVALUATION CRITERIA' to score the written answer.
    - For 'IMAGE' submissions that are attached, evaluate what the image actually shows against the task description and the 'EVALUATION CRITERIA'. If the image does not match the task, say so.
    - For 'AUDIO' or 'VIDEO' submissions, and any image that could not be attached, acknowledge that a file was submitted and check only whether the correct *type* of deliverable was provided. Do not guess at or praise content you cannot inspect, and note in the report that it was not reviewed.
2.  **Behavioral Analysis from Event Log**:
    - Analyze the timestamps to understand the candidate's pacing, time management, and how long they spent on each task (time between 'TASK_ANSWER_CHANGE' events for a taskId).
    - Analyze the frequency and timing of 'CHAT_MESSAGE_SENT' events to gauge their help-seeking behavior and independence.
    - A high number of 'TASK_ANSWER_CHANGE' events for a single task might indicate uncertainty or perfectionism.
3.  **Communication & Stress Management:** Analyze the chat logs and call transcript for clarity, professionalism, and tone. Correlate events with the client call ('CLIENT_CALL_START'/'CLIENT_CALL_END') to assess performance under pressure.
4.  **Synthesize and Score:** Combine all your findings into a holistic report. Provide specific examples in the "Strengths" and "Areas for Improvement" sections, referencing both submitted work and behaviors from the event log. All scores must be an integer out of 10.
5.  **FINAL RECOMMENDATION:** Based on ALL available data (work quality, communication, and behavioral data), provide a hiring recommendation for the recruiter to review.
    - The 'Submission Type' provides important context. An 'auto' submission means the candidate ran out of time, which should be considered when evaluating their time management skills.
    - The \`suitabilityScore\` must be an integer from 1 to 10.
    - The \`recommendation\` must be one of 'HIRE', 'CONSIDER', or 'NO_HIRE'.
    - The \`recommendationReasoning\` should be a concise, 1-2 sentence explanation for your verdict.`;

    await handleJsonCall(res, '/api/analyze-performance', (claude) => claudeJson(claude, {
        model: ANALYSIS_MODEL,
        content: [{ type: 'text', text: prompt }, ...imageBlocks],
        schema: analysisSchema,
        toolName: 'save_performance_report',
        toolDescription: "Save the structured performance report for this candidate.",
    }));
});


app.post('/api/chat-response', async (req, res) => {
    const { simulation, chatHistory } = req.body;
    const system = `You are a helpful AI assistant in a work simulation, acting as a senior colleague.\nThe candidate is performing a simulation for the role of: ${simulation.jobTitle}.\n\nTheir assigned tasks are:\n${simulation.tasks.map(t => `- ${t.title}: ${t.description}`).join('\n')}\n\nYour role is to provide concise, helpful guidance. Do not give away the answers to the tasks directly. Instead, prompt the candidate to think critically. Keep your responses brief and professional.`;

    const messages = toClaudeMessages(
        (chatHistory || []).map(entry => ({ role: entry.author === 'Candidate' ? 'user' : 'assistant', text: entry.message })),
        '(The candidate opened the chat.)',
    );

    await handleTextCall(res, '/api/chat-response', (claude) => claudeText(claude, { model: FAST_MODEL, system, messages }));
});

app.post('/api/client-call-response', async (req, res) => {
    const { jobTitle, chatHistory } = req.body;
    const system = `You are a client calling an employee (${jobTitle}) with an urgent, slightly vague, and stressful problem. Be professional but firm. The goal is to test the employee's communication and problem-solving skills under pressure. The call opens with the employee answering. Stay in character as the client and reply only with what the client says out loud, with no stage directions or labels.`;

    const messages = toClaudeMessages(
        (chatHistory || []).map(entry => ({ role: entry.author === 'You' ? 'user' : 'assistant', text: entry.text })),
        '(Answers the call)',
    );

    await handleTextCall(res, '/api/client-call-response', (claude) => claudeText(claude, { model: FAST_MODEL, system, messages }));
});

app.post('/api/support-chat-response', async (req, res) => {
    const { chatHistory } = req.body;

    // The first entry is the bot's canned greeting, which is not part of the real conversation.
    const processedHistory = [...(chatHistory || [])];
    if (processedHistory.length > 0 && processedHistory[0].author === 'bot') {
        processedHistory.shift();
    }

    if (processedHistory.length === 0) {
        return res.json({ text: "I'm ready to help. What's your question?" });
    }

    const messages = toClaudeMessages(
        processedHistory.map(entry => ({ role: entry.author === 'user' ? 'user' : 'assistant', text: entry.message })),
        '(The user opened the support chat.)',
    );

    const system = `You are a friendly and helpful support assistant for an application called SimuHire. SimuHire is an AI-powered workday simulation platform for hiring.
    - Recruiters use it to create realistic job simulations to test candidates.
    - Candidates complete these simulations to showcase their skills.
    - Key features include AI task generation, a simulated workspace with tools (chat, email, editor, sheets), and AI-powered performance analysis.
    - Upcoming features include webcam proctoring and a secure desktop lockdown.

    Your primary role is to answer user questions about the application's features, how to use it, and general advice on hiring best practices.

    IMPORTANT RULE: If a user asks a question that seems like they are a candidate trying to get help or answers for their simulation tasks, you MUST NOT provide a direct answer. Instead, you should gently decline and remind them that the simulation is meant to assess their own skills. For example, you can say: "I can't help with specific answers for your simulation tasks, as that would defeat the purpose of the assessment. However, I can help you understand how to use the tools in the workspace!"`;

    await handleTextCall(res, '/api/support-chat-response', (claude) => claudeText(claude, { model: FAST_MODEL, system, messages }));
});

// --- Serve Frontend ---
// This catch-all route should be last.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`SimuHire server listening on http://localhost:${port}`);
});