import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Simulation, CandidateWork, PerformanceReport, Task, RecommendationVerdict, TaskAnswer, TaskType, LoggedEvent } from '../types';
import { analyzeCandidatePerformance, getChatResponse } from '../services/aiService';
import { ChatIcon, SpinnerIcon, ExclamationIcon, CheckCircleIcon, XIcon, PhotographIcon, VolumeUpIcon, VideoCameraIcon } from './Icons';
import { ClientCallModal } from './ClientCallModal';
import TaskAssetDisplay from './TaskAssetDisplay';

type TaskStatus = 'pending' | 'submitted';

// --- File Upload Constraints ---
const MAX_IMAGE_SIZE_MB = 10;
const MAX_AUDIO_SIZE_MB = 25;
const MAX_VIDEO_SIZE_MB = 100;

const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_AUDIO_SIZE_BYTES = MAX_AUDIO_SIZE_MB * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ACCEPTED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'];
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];


interface CandidateWorkspaceProps {
  simulation: Simulation;
  onComplete: (completionData: { 
    reportData: Omit<PerformanceReport, 'simulationId' | 'candidateEmail' | 'candidateName' | 'timeTakenSeconds' | 'totalDurationSeconds' | 'completedAt' | 'submissionReason'>,
    timeTakenSeconds: number,
    submissionReason: 'manual' | 'auto',
  }, simulationId: string) => void;
}

const CandidateWorkspace: React.FC<CandidateWorkspaceProps> = ({ simulation, onComplete }) => {
  const [timeLeft, setTimeLeft] = useState(simulation.durationMinutes * 60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCallModal, setShowCallModal] = useState(false);
  const [submissionReason, setSubmissionReason] = useState<'manual' | 'auto'>('manual');
  const [permissionStatus, setPermissionStatus] = useState<'idle' | 'granted' | 'denied'>('idle');

  const storageKey = `simuHire-progress-${simulation.id}`;

  const [taskData, setTaskData] = useState<Record<string, { answer: TaskAnswer; status: TaskStatus }>>(
    () => {
      try {
        const savedProgress = localStorage.getItem(storageKey);
        if (savedProgress) {
          const parsedData = JSON.parse(savedProgress);
          // Check if the saved data has the new structure. If not, ignore it.
          const firstKey = Object.keys(parsedData)[0];
          if (firstKey && parsedData[firstKey].answer && typeof parsedData[firstKey].answer.type !== 'undefined') {
            return parsedData;
          }
        }
      } catch (error) {
        console.error("Failed to load or parse saved progress:", error);
        localStorage.removeItem(storageKey); // Clear corrupted data
      }
      return Object.fromEntries(
        simulation.tasks.map(task => [
          task.id, 
          { 
            answer: { type: task.type, content: '' }, 
            status: 'pending' 
          }
        ])
      );
    }
  );

  const workRef = useRef<Pick<CandidateWork, 'chatLogs' | 'callTranscript' | 'eventLog'>>({
    chatLogs: [{ author: 'AI', message: `Hello! I'm your AI assistant for this simulation. I'm here to act as a senior colleague. Feel free to ask me questions if you get stuck. Good luck!` }],
    callTranscript: 'N/A',
    eventLog: [],
  });

  const timeLeftRef = useRef(simulation.durationMinutes * 60);
  const isSubmittingRef = useRef(false);

  const logEvent = useCallback((type: LoggedEvent['type'], details?: LoggedEvent['details']) => {
    workRef.current.eventLog.push({
      timestamp: new Date().toISOString(),
      type,
      details,
    });
  }, []);

  useEffect(() => {
    logEvent('SIMULATION_START');
    const requestMediaPermissions = async () => {
        try {
            await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setPermissionStatus('granted');
        } catch (err) {
            console.error("Media permission denied:", err);
            setPermissionStatus('denied');
        }
    };
    
    requestMediaPermissions();
  }, [logEvent]);

  const handleCallClose = (transcript: string) => {
    workRef.current.callTranscript = transcript;
    setShowCallModal(false);
  };

  const handleAnswerChange = (taskId: string, newAnswer: TaskAnswer) => {
    if (taskData[taskId].status === 'pending') {
      logEvent('TASK_ANSWER_CHANGE', { taskId });
      setTaskData(prev => ({
        ...prev,
        [taskId]: { ...prev[taskId], answer: newAnswer },
      }));
    }
  };

  const handleSubmitTask = (taskId: string) => {
    if (window.confirm("You cannot edit this answer after submitting. Are you sure you want to submit?")) {
      logEvent('TASK_SUBMIT', { taskId });
      setTaskData(prev => ({
        ...prev,
        [taskId]: { ...prev[taskId], status: 'submitted' },
      }));
    }
  };

  const submitWork = useCallback(async (reason: 'manual' | 'auto' = 'manual') => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    
    logEvent('SIMULATION_SUBMIT', { reason });
    setTimeLeft(0); 

    setIsSubmitting(true);
    setSubmissionReason(reason);

    const timeTaken = simulation.durationMinutes * 60 - timeLeftRef.current;
    
    const finalWork: CandidateWork = {
        chatLogs: workRef.current.chatLogs,
        callTranscript: workRef.current.callTranscript,
        eventLog: workRef.current.eventLog,
        taskAnswers: Object.fromEntries(
            Object.entries(taskData)
                .filter(([, data]) => (data as { status: TaskStatus }).status === 'submitted')
                .map(([id, data]) => [id, (data as { answer: TaskAnswer }).answer])
        )
    };

    try {
        const reportJson = await analyzeCandidatePerformance(
            { jobTitle: simulation.jobTitle, jobDescription: simulation.jobDescription, tasks: simulation.tasks },
            finalWork,
            {
              timeTakenSeconds: timeTaken,
              totalDurationSeconds: simulation.durationMinutes * 60,
              submissionReason: reason
            }
        );
        onComplete({ reportData: JSON.parse(reportJson), timeTakenSeconds: timeTaken, submissionReason: reason }, simulation.id);
    } catch (error) {
        console.error("Failed to submit and analyze work:", error);
        const errorReport = {
            summary: "Could not generate AI analysis due to a submission error.",
            strengths: [],
            areasForImprovement: ["The AI analysis service failed. The recruiter will review the raw data manually."],
            stressManagementScore: 0,
            communicationScore: 0,
            problemSolvingScore: 0,
            recommendation: RecommendationVerdict.CONSIDER,
            suitabilityScore: 0,
            recommendationReasoning: "AI analysis failed due to a server error. Manual review of the candidate's work is required."
        };
        onComplete({ reportData: errorReport, timeTakenSeconds: timeTaken, submissionReason: reason }, simulation.id);
    } finally {
        localStorage.removeItem(storageKey);
    }
  }, [simulation, onComplete, taskData, storageKey, logEvent]);


  // Effect for timer and auto-submission
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          submitWork('auto');
          return 0;
        }
        timeLeftRef.current = prev - 1;
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [submitWork]);

  // Effect for auto-saving progress
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      localStorage.setItem(storageKey, JSON.stringify(taskData));
    }, 30000); // Save every 30 seconds

    return () => {
      clearInterval(autoSaveInterval);
    };
  }, [taskData, storageKey]);
  

  // Effect for scheduling the client call
  useEffect(() => {
    if (simulation.clientCallEnabled) {
      const minTime = simulation.clientCallTimeRange?.min ?? 10;
      const maxTime = simulation.clientCallTimeRange?.max ?? 50;

      if (minTime < maxTime) {
        const randomTimeInMinutes = Math.random() * (maxTime - minTime) + minTime;
        const randomCallTimeInMillis = randomTimeInMinutes * 60 * 1000;
        
        const callTimeout = setTimeout(() => {
            if (!isSubmittingRef.current) {
              setShowCallModal(true);
            }
        }, randomCallTimeInMillis);
        return () => clearTimeout(callTimeout);
      }
    }
  }, [simulation.clientCallEnabled, simulation.clientCallTimeRange]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  const totalTasks = simulation.tasks.length;
  const completedTasks = Object.values(taskData).filter(data => data.status === 'submitted').length;
  const progressPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  const PermissionStatusIndicator: React.FC<{ status: 'granted' | 'denied' }> = ({ status }) => {
    if (status === 'granted') {
        return (
            <div className="flex items-center gap-2 text-sm text-green-400" title="Camera and microphone access granted.">
                <CheckCircleIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Mic & Camera Ready</span>
            </div>
        );
    }
    if (status === 'denied') {
        return (
            <div className="flex items-center gap-2 text-sm text-yellow-400" title="Access denied. Video tasks and client calls may not work. Please enable permissions in your browser settings.">
                <ExclamationIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Permissions Denied</span>
            </div>
        );
    }
    return null;
  };

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      {isSubmitting && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="text-center text-white flex flex-col items-center">
                <SpinnerIcon className="w-12 h-12 text-blue-400 mb-4" />
                <p className="text-2xl font-bold">
                  {submissionReason === 'auto'
                    ? 'Auto-Submitting Session...'
                    : 'Submitting and Analyzing...'}
                </p>
                <p className="text-slate-300">
                  {submissionReason === 'auto'
                    ? 'Session ended due to timeout.'
                    : 'Our AI is evaluating your performance. Please wait.'}
                </p>
            </div>
        </div>
      )}
      {showCallModal && <ClientCallModal jobTitle={simulation.jobTitle} onClose={handleCallClose} logEvent={logEvent} />}

      <header className="flex-shrink-0 flex flex-col p-4 bg-slate-800/50 border-b border-slate-700 rounded-t-lg">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl font-bold">{simulation.jobTitle} Simulation</h2>
          </div>
          <div className="flex items-center gap-4">
            {permissionStatus !== 'idle' && <PermissionStatusIndicator status={permissionStatus} />}
            <div className="text-lg font-mono bg-slate-700 px-3 py-1 rounded-md">
              {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
            </div>
            <button 
              onClick={() => submitWork('manual')}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition-colors"
            >
              Finish & Submit
            </button>
          </div>
        </div>
        
        <div className="w-full space-y-1">
          <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
            <span>Overall Progress</span>
            <span>{completedTasks} of {totalTasks} tasks completed ({Math.round(progressPercentage)}%)</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
            <div 
              className="bg-blue-500 h-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      </header>

      <div className="flex-grow flex flex-col md:flex-row min-h-0">
        <main className="w-full md:w-2/3 p-4 bg-slate-900 overflow-y-auto">
          <h3 className="text-lg font-semibold mb-4 text-blue-300">Your Tasks</h3>
          <div className="space-y-6">
            {simulation.tasks.map(task => (
              <TaskAnswerCard
                key={task.id}
                task={task}
                data={taskData[task.id]}
                onAnswerChange={handleAnswerChange}
                onSubmit={handleSubmitTask}
              />
            ))}
          </div>
        </main>
        <aside className="w-full md:w-1/3 border-l border-slate-700 bg-slate-800 flex flex-col">
            <ChatTool workRef={workRef} simulation={simulation} logEvent={logEvent} />
        </aside>
      </div>
    </div>
  );
};

interface TaskAnswerCardProps {
  task: Task;
  data: { answer: TaskAnswer; status: TaskStatus };
  onAnswerChange: (taskId: string, answer: TaskAnswer) => void;
  onSubmit: (taskId: string) => void;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]); // remove data url prefix
    reader.onerror = error => reject(error);
});

const FilePreview: React.FC<{ answer: TaskAnswer }> = ({ answer }) => {
  if (!answer.content || !answer.fileType) return null;

  const dataUrl = `data:${answer.fileType};base64,${answer.content}`;

  switch (answer.type) {
    case TaskType.IMAGE:
      return (
        <div className="mt-4 p-2 bg-slate-900/50 rounded-md border border-slate-700">
          <p className="text-xs text-slate-400 mb-2 text-center font-semibold">Image Preview</p>
          <img
            src={dataUrl}
            alt={answer.fileName || 'Image preview'}
            className="max-w-full max-h-64 mx-auto rounded"
          />
        </div>
      );
    case TaskType.AUDIO:
      return (
        <div className="mt-4 p-2 bg-slate-900/50 rounded-md border border-slate-700">
          <p className="text-xs text-slate-400 mb-2 font-semibold">Audio Preview</p>
          <audio controls src={dataUrl} className="w-full">
            Your browser does not support the audio element.
          </audio>
        </div>
      );
    case TaskType.VIDEO:
      return (
        <div className="mt-4 p-2 bg-slate-900/50 rounded-md border border-slate-700">
          <p className="text-xs text-slate-400 mb-2 text-center font-semibold">Video Preview</p>
          <video controls src={dataUrl} className="max-w-full max-h-64 mx-auto rounded">
            Your browser does not support the video tag.
          </video>
        </div>
      );
    default:
      return null;
  }
};

const TaskAnswerCard: React.FC<TaskAnswerCardProps> = ({ task, data, onAnswerChange, onSubmit }) => {
  const isSubmitted = data.status === 'submitted';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const file = e.target.files?.[0];

    if (file) {
      const validationConfig = {
        [TaskType.IMAGE]: {
          maxSize: MAX_IMAGE_SIZE_BYTES,
          maxSizeMB: MAX_IMAGE_SIZE_MB,
          acceptedTypes: ACCEPTED_IMAGE_TYPES,
          typeName: 'image',
          acceptedExtensions: 'JPG, PNG, GIF, WEBP',
        },
        [TaskType.AUDIO]: {
          maxSize: MAX_AUDIO_SIZE_BYTES,
          maxSizeMB: MAX_AUDIO_SIZE_MB,
          acceptedTypes: ACCEPTED_AUDIO_TYPES,
          typeName: 'audio',
          acceptedExtensions: 'MP3, WAV, OGG, WEBM',
        },
        [TaskType.VIDEO]: {
          maxSize: MAX_VIDEO_SIZE_BYTES,
          maxSizeMB: MAX_VIDEO_SIZE_MB,
          acceptedTypes: ACCEPTED_VIDEO_TYPES,
          typeName: 'video',
          acceptedExtensions: 'MP4, WEBM, MOV',
        },
      };

      const config = validationConfig[task.type as keyof typeof validationConfig];

      if (config) {
        if (file.size > config.maxSize) {
          setFileError(`File is too large. Max size for ${config.typeName}s is ${config.maxSizeMB}MB.`);
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }

        if (!config.acceptedTypes.includes(file.type)) {
          setFileError(`Invalid file type. Please upload: ${config.acceptedExtensions}.`);
          if (fileInputRef.current) fileInputRef.current.value = "";
          return;
        }
      }

      try {
        const base64Content = await fileToBase64(file);
        onAnswerChange(task.id, {
          type: task.type,
          content: base64Content,
          fileName: file.name,
          fileType: file.type,
        });
      } catch (error) {
        console.error("Error converting file to base64", error);
        setFileError("There was an error processing the file. Please try again.");
      }
    }
  };

  const handleRemoveFile = () => {
    onAnswerChange(task.id, { type: task.type, content: ''});
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const renderInput = () => {
    if (isSubmitted) {
      switch (task.type) {
        case TaskType.TEXT:
          return (
            <textarea
              value={data.answer.content}
              disabled
              rows={6}
              className="w-full bg-slate-800 text-slate-500 rounded-md p-3"
            />
          );
        default: // For IMAGE, AUDIO, VIDEO
          return (
            <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-md">
              <CheckCircleIcon className="w-6 h-6 text-green-400 flex-shrink-0" />
              <div>
                  <p className="font-semibold text-slate-300">File Submitted:</p>
                  <p className="text-sm text-slate-400 truncate">{data.answer.fileName}</p>
              </div>
            </div>
          );
      }
    }

    // Render active inputs for pending tasks
    switch (task.type) {
        case TaskType.TEXT:
            return (
                <textarea
                    value={data.answer.content}
                    onChange={(e) => onAnswerChange(task.id, { type: TaskType.TEXT, content: e.target.value })}
                    placeholder="Type your answer here..."
                    rows={6}
                    className="w-full bg-slate-700 border border-slate-600 rounded-md p-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            );
        case TaskType.IMAGE:
        case TaskType.AUDIO:
        case TaskType.VIDEO:
            const fileTypeAccepts = {
                [TaskType.IMAGE]: ACCEPTED_IMAGE_TYPES.join(','),
                [TaskType.AUDIO]: ACCEPTED_AUDIO_TYPES.join(','),
                [TaskType.VIDEO]: ACCEPTED_VIDEO_TYPES.join(','),
            }[task.type];
            
            const hintText = {
                [TaskType.IMAGE]: `Max ${MAX_IMAGE_SIZE_MB}MB. (${ACCEPTED_IMAGE_TYPES.map(t => t.split('/')[1].toUpperCase()).join(', ')})`,
                [TaskType.AUDIO]: `Max ${MAX_AUDIO_SIZE_MB}MB. (MP3, WAV, OGG)`,
                [TaskType.VIDEO]: `Max ${MAX_VIDEO_SIZE_MB}MB. (MP4, WEBM, MOV)`,
            }[task.type];

            const UploadIcon = {
                [TaskType.IMAGE]: PhotographIcon,
                [TaskType.AUDIO]: VolumeUpIcon,
                [TaskType.VIDEO]: VideoCameraIcon,
            }[task.type];

            if (data.answer.content) { // A file has been selected
                return (
                    <div>
                        <div className="flex items-center justify-between p-3 bg-slate-700 rounded-md border border-slate-600">
                           <div className="flex items-center gap-3 overflow-hidden">
                               <UploadIcon className="w-6 h-6 text-blue-300 flex-shrink-0" />
                               <p className="text-sm text-white truncate">{data.answer.fileName}</p>
                           </div>
                            <button 
                                onClick={handleRemoveFile}
                                className="text-slate-400 hover:text-red-400 p-1"
                                title="Remove file"
                            >
                                <XIcon className="w-5 h-5"/>
                            </button>
                        </div>
                        <FilePreview answer={data.answer} />
                    </div>
                )
            }

            return (
                <>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept={fileTypeAccepts}
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-600 rounded-lg hover:border-blue-500 hover:bg-slate-700/50 transition-colors"
                    >
                       <UploadIcon className="w-10 h-10 text-slate-400 mb-2" />
                       <span className="text-blue-400 font-semibold">Choose a file to upload</span>
                       <span className="text-xs text-slate-500 mt-1">{hintText}</span>
                    </button>
                    {fileError && <p className="text-center text-red-400 text-sm mt-2">{fileError}</p>}
                </>
            );
        default:
            return null;
    }
  };

  const isSubmittable = () => {
    if (isSubmitted) return false;
    if (task.type === TaskType.TEXT) return !!data.answer.content.trim();
    return !!data.answer.content;
  };
  
  return (
    <div className={`bg-slate-800/70 p-4 rounded-lg border ${isSubmitted ? 'border-green-500/50' : 'border-slate-700'}`}>
      <div className="flex justify-between items-start">
        <div>
          <p className="font-bold text-lg text-blue-300">{task.title}</p>
          <p className="text-sm text-slate-400 mt-1">{task.description}</p>
        </div>
        {isSubmitted && (
          <div className="flex items-center gap-2 text-green-400 font-semibold text-sm bg-green-500/10 px-3 py-1 rounded-full">
            <CheckCircleIcon className="w-5 h-5" />
            <span>Submitted</span>
          </div>
        )}
      </div>
      
      {task.asset && <TaskAssetDisplay asset={task.asset} />}

      <div className="mt-4">
        {renderInput()}
      </div>
      <div className="mt-3 flex justify-end">
        <button
          onClick={() => onSubmit(task.id)}
          disabled={!isSubmittable()}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-5 rounded-md text-sm transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed"
        >
          Submit Task
        </button>
      </div>
    </div>
  );
};

const ChatTool: React.FC<{
  workRef: React.MutableRefObject<Pick<CandidateWork, 'chatLogs' | 'eventLog'>>;
  simulation: Simulation;
  logEvent: (type: LoggedEvent['type'], details?: LoggedEvent['details']) => void;
}> = ({ workRef, simulation, logEvent }) => {
  const [messages, setMessages] = useState(workRef.current.chatLogs);
  const [input, setInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAiTyping]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput || isAiTyping) return;

    logEvent('CHAT_MESSAGE_SENT', { messageLength: trimmedInput.length });

    const userMessage = { author: 'Candidate' as const, message: trimmedInput };
    const newMessages = [...messages, userMessage];
    
    setMessages(newMessages);
    workRef.current.chatLogs = newMessages;
    setInput('');
    setIsAiTyping(true);

    try {
        const aiResponse = await getChatResponse(
          { jobTitle: simulation.jobTitle, tasks: simulation.tasks },
          newMessages
        );
        const aiMessage = { author: 'AI' as const, message: aiResponse };
        const finalMessages = [...newMessages, aiMessage];
        setMessages(finalMessages);
        workRef.current.chatLogs = finalMessages;
    } catch (error) {
        const errorMessage = { author: 'AI' as const, message: "I'm sorry, I encountered an error. Please try again." };
        const finalMessages = [...newMessages, errorMessage];
        setMessages(finalMessages);
        workRef.current.chatLogs = finalMessages;
        console.error("Chat error:", error);
    } finally {
        setIsAiTyping(false);
    }
  };
    
  return (
      <div className="flex flex-col h-full">
          <header className="flex-shrink-0 p-4 border-b border-slate-700 flex items-center gap-2">
            <ChatIcon className="w-6 h-6 text-blue-400" />
            <h3 className="text-lg font-semibold">AI Assistant</h3>
          </header>
          <div className="flex-grow overflow-y-auto p-4 space-y-4">
              {messages.map((msg, index) => (
                  <div key={index} className={`flex ${msg.author === 'Candidate' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-xs px-4 py-2 rounded-lg ${msg.author === 'Candidate' ? 'bg-blue-600' : 'bg-slate-700'}`}>
                          <p className="text-white text-sm">{msg.message}</p>
                      </div>
                  </div>
              ))}
              {isAiTyping && (
                  <div className="flex justify-start">
                      <div className="bg-slate-700 px-4 py-2 rounded-lg">
                          <div className="flex items-center space-x-1">
                              <span className="text-white animate-pulse">.</span>
                              <span className="text-white animate-pulse delay-150">.</span>
                              <span className="text-white animate-pulse delay-300">.</span>
                          </div>
                      </div>
                  </div>
              )}
              <div ref={messagesEndRef} />
          </div>
          <form onSubmit={handleSend} className="flex-shrink-0 p-4 bg-slate-800/50 border-t border-slate-700">
              <div className="flex gap-2">
                  <input
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Ask your AI assistant..."
                      className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={isAiTyping}
                  />
                  <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:bg-slate-500" disabled={isAiTyping || !input.trim()}>
                      Send
                  </button>
              </div>
          </form>
      </div>
  )
}

export default CandidateWorkspace;