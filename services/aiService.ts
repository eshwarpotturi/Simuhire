import type { Task, CandidateWork, Simulation, TaskGroup } from '../types';

// Generic fetch handler for API calls
async function postApi<T>(endpoint: string, body: object): Promise<T> {
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            let errorMessage = `The server responded with status ${response.status}.`;
            try {
                // Try to get a more specific error from the server's JSON response
                const errorBody = await response.json();
                if (errorBody && errorBody.error) {
                    errorMessage = errorBody.error;
                }
            } catch (e) {
                // The response body was not JSON, stick with the status code message.
            }
            throw new Error(errorMessage);
        }
        return await response.json();
    } catch (error) {
        // Catch network errors or errors from the check above
        if (error instanceof Error) {
            console.error(`API Error for ${endpoint}:`, error.message);
            // Add a more user-friendly message for common network issues
            if (error.message.includes('Failed to fetch')) {
                throw new Error('Network error. Please check your internet connection and try again.');
            }
            throw error; // Re-throw the error to be handled by the caller
        }
        // Fallback for unexpected error types
        throw new Error(`An unexpected error occurred. Please check your network connection.`);
    }
}


export const generateSimulationTasks = async (jobTitle: string, jobDescription: string): Promise<Task[]> => {
    const tasks = await postApi<Task[]>('/api/generate-tasks', { jobTitle, jobDescription });
    if (!tasks || tasks.length === 0) {
        throw new Error("The AI service returned an empty list of tasks. Please try refining your job description.");
    }
    return tasks;
};

export const modifySimulationTasks = async (
  jobTitle: string,
  jobDescription: string,
  currentTasks: Task[],
  modification: string
): Promise<Task[]> => {
    const tasks = await postApi<Task[]>('/api/modify-tasks', { jobTitle, jobDescription, currentTasks, modification });
    if (!tasks || tasks.length === 0) {
        // Don't throw, just return current tasks as a safe fallback
        return currentTasks;
    }
    return tasks;
};

export const regenerateOrModifySingleTask = async (
  jobTitle: string,
  jobDescription: string,
  allTasks: Task[],
  taskToChange: Task,
  instruction: string
): Promise<Omit<Task, 'id'>> => {
  return await postApi<Omit<Task, 'id'>>('/api/regenerate-single-task', { jobTitle, jobDescription, allTasks, taskToChange, instruction });
};

export const generateSingleTask = async (
  jobTitle: string,
  jobDescription: string,
  existingTasks: Task[]
): Promise<Omit<Task, 'id'>> => {
    return await postApi<Omit<Task, 'id'>>('/api/generate-single-task', { jobTitle, jobDescription, existingTasks });
};

export const groupTasks = async (tasks: Task[]): Promise<Omit<TaskGroup, 'id'>[]> => {
    return await postApi<Omit<TaskGroup, 'id'>[]>('/api/group-tasks', { tasks });
};

export const suggestEvaluationCriteria = async (taskTitle: string, taskDescription: string): Promise<string> => {
    const result = await postApi<{ text: string }>('/api/suggest-criteria', { taskTitle, taskDescription });
    return result.text;
};

export const analyzeCandidatePerformance = async (
  simulation: {jobTitle: string, jobDescription: string, tasks: Task[]},
  work: CandidateWork,
  behavioralData: { timeTakenSeconds: number, totalDurationSeconds: number, submissionReason: 'manual' | 'auto' }
): Promise<string> => {
    const report = await postApi<object>('/api/analyze-performance', { simulation, work, behavioralData });
    return JSON.stringify(report);
};

export const getChatResponse = async (
  simulation: { jobTitle: string; tasks: Task[] },
  chatHistory: { author: 'Candidate' | 'AI'; message: string }[]
): Promise<string> => {
  const result = await postApi<{ text: string }>('/api/chat-response', { simulation, chatHistory });
  return result.text;
};

export const getClientCallResponse = async (
  jobTitle: string,
  chatHistory: { author: 'Client' | 'You'; text: string }[]
): Promise<string> => {
    const result = await postApi<{ text: string }>('/api/client-call-response', { jobTitle, chatHistory });
    return result.text;
};

export const getSupportChatResponse = async (
  chatHistory: { author: 'user' | 'bot'; message: string }[]
): Promise<string> => {
  const result = await postApi<{ text: string }>('/api/support-chat-response', { chatHistory });
  return result.text;
};