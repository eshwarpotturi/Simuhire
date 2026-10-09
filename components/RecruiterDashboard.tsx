import React, { useState, useMemo, useEffect } from 'react';
import { generateSimulationTasks, modifySimulationTasks, regenerateOrModifySingleTask, generateSingleTask, groupTasks, suggestEvaluationCriteria } from '../services/aiService';
import { Simulation, Tool, Task, PerformanceReport, TaskGroup, SimulationTemplate, TaskType } from '../types';
import { PencilIcon, RefreshIcon, TrashIcon, PlusIcon, SpinnerIcon, ClipboardIcon, CalendarIcon, ClockIcon, CheckCircleIcon, ChartBarIcon, CollectionIcon, CheckBadgeIcon, AcademicCapIcon, DragHandleIcon, BookmarkIcon, SparklesIcon, ChevronUpIcon, ChevronDownIcon, DocumentTextIcon, PhotographIcon, VolumeUpIcon, VideoCameraIcon } from './Icons';
import SimulationPreviewModal from './SimulationPreviewModal';
import TaskAssetDisplay from './TaskAssetDisplay';

interface RecruiterDashboardProps {
  onCreateSimulation: (simulation: Simulation) => void;
  createdSimulation: Simulation | null;
  previousSimulations: Simulation[];
  completedReports: Record<string, PerformanceReport>;
  onViewReport: (report: PerformanceReport) => void;
  templates: SimulationTemplate[];
  onSaveTemplate: (template: Omit<SimulationTemplate, 'id' | 'createdAt'>) => void;
  onDeleteTemplate: (templateId: string) => void;
}

type Step = 'form' | 'validate' | 'created';
type RecruiterTab = 'create' | 'analytics';

const RecruiterDashboard: React.FC<RecruiterDashboardProps> = (props) => {
  const [activeTab, setActiveTab] = useState<RecruiterTab>('create');

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-bold">Recruiter Dashboard</h2>
        <div className="bg-slate-800 p-1 rounded-lg flex gap-1 border border-slate-700">
           <TabButton
            label="Create"
            icon={<PlusIcon className="w-5 h-5" />}
            isActive={activeTab === 'create'}
            onClick={() => setActiveTab('create')}
          />
          <TabButton
            label="Analytics"
            icon={<ChartBarIcon className="w-5 h-5" />}
            isActive={activeTab === 'analytics'}
            onClick={() => setActiveTab('analytics')}
          />
        </div>
      </div>
      
      {activeTab === 'create' ? (
        <CreateSimulationView {...props} onSwitchTab={setActiveTab} />
      ) : (
        <AnalyticsView simulations={props.previousSimulations} reports={Object.values(props.completedReports)} onViewReport={props.onViewReport} />
      )}
    </div>
  );
};

const TabButton: React.FC<{label: string, icon: React.ReactNode, isActive: boolean, onClick: () => void}> = ({ label, icon, isActive, onClick}) => (
  <button onClick={onClick} className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors ${isActive ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>
    {icon}
    {label}
  </button>
);

const TaskTypeIcon = ({ type }: { type: TaskType }) => {
    switch (type) {
        case TaskType.TEXT:
            return <DocumentTextIcon title="Text Task" className="w-5 h-5 text-slate-400" />;
        case TaskType.IMAGE:
            return <PhotographIcon title="Image Upload Task" className="w-5 h-5 text-slate-400" />;
        case TaskType.AUDIO:
            return <VolumeUpIcon title="Audio Upload Task" className="w-5 h-5 text-slate-400" />;
        case TaskType.VIDEO:
            return <VideoCameraIcon title="Video Upload Task" className="w-5 h-5 text-slate-400" />;
        default:
            return null;
    }
};

interface CreateSimulationViewProps extends RecruiterDashboardProps {
  onSwitchTab: (tab: RecruiterTab) => void;
}

const CreateSimulationView: React.FC<CreateSimulationViewProps> = ({ onCreateSimulation, createdSimulation, previousSimulations, completedReports, onViewReport, templates, onSaveTemplate, onDeleteTemplate, onSwitchTab }) => {
  const [step, setStep] = useState<Step>('form');
  const [jobTitle, setJobTitle] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [clientCallEnabled, setClientCallEnabled] = useState(true);
  const [callTimeMin, setCallTimeMin] = useState(10);
  const [callTimeMax, setCallTimeMax] = useState(50);
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [isGrouped, setIsGrouped] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState('');

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState('');
  const [taskSpecificLoading, setTaskSpecificLoading] = useState<Record<string, string | false>>({});
  const [criteriaLoadingTaskId, setCriteriaLoadingTaskId] = useState<string | null>(null);

  const [showCustomTaskForm, setShowCustomTaskForm] = useState(false);
  const [customTaskTitle, setCustomTaskTitle] = useState('');
  const [customTaskDescription, setCustomTaskDescription] = useState('');
  const [customTaskCriteria, setCustomTaskCriteria] = useState('');
  const [customTaskType, setCustomTaskType] = useState<TaskType>(TaskType.TEXT);
  
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<{ groupIndex: number; taskIndex: number } | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateSaveSuccess, setTemplateSaveSuccess] = useState(false);


  useEffect(() => {
    if (createdSimulation) {
      const activeSimId = createdSimulation.id;
      if (previousSimulations.length > 0 && previousSimulations[0].id !== activeSimId) {
        setStep('form');
      }
    }
  }, [previousSimulations, createdSimulation]);

  const availableTools: Tool[] = [Tool.CHAT, Tool.EDITOR, Tool.SHEET, Tool.EMAIL];
  
  const isFormValid = useMemo(() => {
    if (!clientCallEnabled) return true;
    return callTimeMin < callTimeMax && callTimeMax <= durationMinutes;
  }, [clientCallEnabled, callTimeMin, callTimeMax, durationMinutes]);

  const handleGenerateTasks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobTitle.trim() || !jobDescription.trim()) {
      setError('Job title and description cannot be empty.');
      return;
    }
    if (!isFormValid) {
        setError('Please fix the errors in the form before continuing.');
        return;
    }
    setError('');
    setLoadingAction('Generating tasks...');

    try {
      const generatedTasks = await generateSimulationTasks(jobTitle, jobDescription);
      setTaskGroups([{ id: `group-${Date.now()}`, title: "Generated Tasks", tasks: generatedTasks }]);
      setIsGrouped(false);
      setStep('validate');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate tasks. Please try again.');
      console.error(err);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleModifyTasks = async (modification: string) => {
    if (isGrouped && !window.confirm("This action will reset the current task grouping. Do you want to continue?")) {
        return;
    }
    setLoadingAction('Applying modifications...');
    setError('');
    try {
        const allTasks = taskGroups.flatMap((g: TaskGroup) => g.tasks);
        const modifiedTasks = await modifySimulationTasks(jobTitle, jobDescription, allTasks, modification);
        setTaskGroups([{ id: `group-${Date.now()}`, title: "Modified Tasks", tasks: modifiedTasks }]);
        setIsGrouped(false);
    } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to modify tasks. Please try again.');
        console.error(err);
    } finally {
        setLoadingAction(null);
    }
  };

  const handleGroupTasks = async () => {
    const allTasks = taskGroups.flatMap((g: TaskGroup) => g.tasks);
    if (allTasks.length < 2) return;
    setLoadingAction('Grouping tasks with AI...');
    setError('');
    try {
        const newGroupsRaw = await groupTasks(allTasks);
        const newGroupsWithIds = newGroupsRaw.map((g, index) => ({ ...g, id: `group-${Date.now()}-${index}` }));
        setTaskGroups(newGroupsWithIds);
        setIsGrouped(true);
    } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to group tasks.');
    } finally {
        setLoadingAction(null);
    }
  };

  const handleUngroupTasks = () => {
    const allTasks = taskGroups.flatMap((g: TaskGroup) => g.tasks);
    setTaskGroups([{ id: `group-${Date.now()}`, title: "All Tasks", tasks: allTasks }]);
    setIsGrouped(false);
  };
  
  const handleFinalizeSimulation = () => {
    const allTasks = taskGroups.flatMap((g: TaskGroup) => g.tasks);
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const newSimulation: Omit<Simulation, 'recruiterEmail' | 'createdAt'> = {
        id: `SIM-${dateStr}`,
        jobTitle,
        jobDescription,
        tasks: allTasks,
        availableTools,
        clientCallEnabled,
        durationMinutes,
        ...(clientCallEnabled && {
            clientCallTimeRange: {
                min: callTimeMin,
                max: callTimeMax,
            }
        })
      };
      onCreateSimulation(newSimulation as Simulation);
      setStep('created');
  };

  const setTaskLoading = (taskId: string, loadingMessage: string | false) => {
    setTaskSpecificLoading(prev => ({ ...prev, [taskId]: loadingMessage }));
  };

  const handleRegenerateTask = async (taskToRegenerate: Task, groupIndex: number, taskIndex: number) => {
      setTaskLoading(taskToRegenerate.id, 'Regenerating...');
      setError('');
      try {
          const allTasks = taskGroups.flatMap((g: TaskGroup) => g.tasks);
          const newContent = await regenerateOrModifySingleTask(
              jobTitle,
              jobDescription,
              allTasks,
              taskToRegenerate,
              "Regenerate this task completely to be something new and different."
          );
          const newGroups = [...taskGroups];
          newGroups[groupIndex].tasks[taskIndex] = { ...newGroups[groupIndex].tasks[taskIndex], ...newContent };
          setTaskGroups(newGroups);
      } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to regenerate task.');
      } finally {
          setTaskLoading(taskToRegenerate.id, false);
      }
  };

  const handleChangeTaskDifficulty = async (taskToChange: Task, groupIndex: number, taskIndex: number, direction: 'increase' | 'decrease') => {
    setTaskLoading(taskToChange.id, 'Adjusting difficulty...');
    setError('');
    try {
        const allTasks = taskGroups.flatMap((g: TaskGroup) => g.tasks);
        const instruction = direction === 'increase' 
            ? "Make this task more difficult and complex, suitable for a senior-level candidate." 
            : "Make this task easier and more straightforward, suitable for a junior-level candidate.";
        
        const newContent = await regenerateOrModifySingleTask(
            jobTitle,
            jobDescription,
            allTasks,
            taskToChange,
            instruction
        );
        
        const newGroups = [...taskGroups];
        newGroups[groupIndex].tasks[taskIndex] = { ...newGroups[groupIndex].tasks[taskIndex], ...newContent };
        setTaskGroups(newGroups);
    } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to adjust task difficulty.');
    } finally {
        setTaskLoading(taskToChange.id, false);
    }
  };

  const handleDeleteTask = (groupIndex: number, taskIndex: number) => {
      const newGroups = JSON.parse(JSON.stringify(taskGroups));
      newGroups[groupIndex].tasks.splice(taskIndex, 1);
      setTaskGroups(newGroups.filter((g: TaskGroup) => g.tasks.length > 0));
  };

  const handleStartEdit = (task: Task) => {
      setEditingTaskId(task.id);
      setEditInstruction('');
  };

  const handleCancelEdit = () => {
      setEditingTaskId(null);
      setEditInstruction('');
  };

  const handleSaveChanges = async (taskToSave: Task, groupIndex: number, taskIndex: number) => {
      if (!editInstruction.trim()) return;
      setTaskLoading(taskToSave.id, 'Saving changes...');
      setEditingTaskId(null);
      setError('');
      try {
          const allTasks = taskGroups.flatMap((g: TaskGroup) => g.tasks);
          const newContent = await regenerateOrModifySingleTask(
              jobTitle,
              jobDescription,
              allTasks,
              taskToSave,
              editInstruction
          );
          const newGroups = [...taskGroups];
          newGroups[groupIndex].tasks[taskIndex] = { ...newGroups[groupIndex].tasks[taskIndex], ...newContent };
          setTaskGroups(newGroups);
      } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to save changes.');
      } finally {
          setTaskLoading(taskToSave.id, false);
          setEditInstruction('');
      }
  };

  const handleAddNewTask = async () => {
      setLoadingAction('Adding AI-generated task...');
      setError('');
      try {
          const allTasks = taskGroups.flatMap((g: TaskGroup) => g.tasks);
          const newTaskContent = await generateSingleTask(jobTitle, jobDescription, allTasks);
          const newTask: Task = {
              ...newTaskContent,
              id: `task-${Date.now()}`
          };
          const newGroups = [...taskGroups];
          if (newGroups.length === 0) {
              newGroups.push({ id: `group-${Date.now()}`, title: 'New Tasks', tasks: [newTask] });
          } else {
              newGroups[newGroups.length - 1].tasks.push(newTask);
          }
          setTaskGroups(newGroups);
      } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to add a new task.');
      } finally {
          setLoadingAction(null);
      }
  };
  
  const handleCancelCustomTask = () => {
    setShowCustomTaskForm(false);
    setCustomTaskTitle('');
    setCustomTaskDescription('');
    setCustomTaskCriteria('');
    setCustomTaskType(TaskType.TEXT);
  };

  const handleSaveCustomTask = () => {
    if (!customTaskTitle.trim() || !customTaskDescription.trim()) {
      setError('Custom task title and description cannot be empty.');
      return;
    }
    setError('');
    const newTask: Task = {
      id: `task-${Date.now()}`,
      title: customTaskTitle.trim(),
      description: customTaskDescription.trim(),
      evaluationCriteria: customTaskCriteria.trim() || undefined,
      type: customTaskType,
    };
    const newGroups = [...taskGroups];
    if (newGroups.length === 0) {
        newGroups.push({ id: `group-${Date.now()}`, title: 'Custom Tasks', tasks: [newTask] });
    } else {
        newGroups[newGroups.length - 1].tasks.push(newTask);
    }
    setTaskGroups(newGroups);
    handleCancelCustomTask();
  };
  
  const handleCopyToClipboard = (id: string, isUrl: boolean = false) => {
    const textToCopy = isUrl ? `${window.location.origin}${window.location.pathname}?simId=${id}` : id;
    navigator.clipboard.writeText(textToCopy).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleDragStart = (e: React.DragEvent, position: { groupIndex: number; taskIndex: number }) => {
    setDraggedItem(position);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetPosition: { groupIndex: number; taskIndex: number }) => {
    if (!draggedItem) return;
    
    e.preventDefault();

    const newGroups = JSON.parse(JSON.stringify(taskGroups));
    const { groupIndex: sourceGroupIndex, taskIndex: sourceTaskIndex } = draggedItem;
    const { groupIndex: targetGroupIndex, taskIndex: targetTaskIndex } = targetPosition;

    // Remove item from source
    const [draggedTask] = newGroups[sourceGroupIndex].tasks.splice(sourceTaskIndex, 1);
    
    // Add item to target
    newGroups[targetGroupIndex].tasks.splice(targetTaskIndex, 0, draggedTask);

    // Clean up empty groups and update state
    setTaskGroups(newGroups.filter((g: TaskGroup) => g.tasks.length > 0));
    setDraggedItem(null);
  };

  const handleCriteriaChange = (groupIndex: number, taskIndex: number, criteria: string) => {
    const newGroups = JSON.parse(JSON.stringify(taskGroups));
    newGroups[groupIndex].tasks[taskIndex].evaluationCriteria = criteria;
    setTaskGroups(newGroups);
  };

  const handleSuggestCriteria = async (taskId: string, title: string, description: string, groupIndex: number, taskIndex: number) => {
    setCriteriaLoadingTaskId(taskId);
    setError('');
    try {
      const suggested = await suggestEvaluationCriteria(title, description);
      handleCriteriaChange(groupIndex, taskIndex, suggested);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to suggest criteria.');
    } finally {
      setCriteriaLoadingTaskId(null);
    }
  };
    
  const allTasksCount = useMemo(() => taskGroups.flatMap((g: TaskGroup) => g.tasks).length, [taskGroups]);
  const allTasksForPreview = useMemo(() => taskGroups.flatMap((g: TaskGroup) => g.tasks), [taskGroups]);

  const handleConfirmSaveTemplate = () => {
    if (!templateName.trim()) {
      // Simple validation, can be enhanced
      alert("Template name cannot be empty.");
      return;
    }
    
    const templateData = {
      name: templateName,
      description: templateDescription,
      tasks: taskGroups.flatMap((g: TaskGroup) => g.tasks),
      durationMinutes,
      clientCallEnabled,
      ...(clientCallEnabled && {
        clientCallTimeRange: { min: callTimeMin, max: callTimeMax }
      })
    };
    
    onSaveTemplate(templateData);

    setShowSaveTemplateModal(false);
    setTemplateName('');
    setTemplateDescription('');
    setTemplateSaveSuccess(true);
    setTimeout(() => setTemplateSaveSuccess(false), 3000);
  };

  const handleLoadTemplate = (template: SimulationTemplate) => {
    if (window.confirm("Loading this template will overwrite any current settings in the form. Continue?")) {
      setDurationMinutes(template.durationMinutes);
      setClientCallEnabled(template.clientCallEnabled);
      if(template.clientCallEnabled && template.clientCallTimeRange) {
        setCallTimeMin(template.clientCallTimeRange.min);
        setCallTimeMax(template.clientCallTimeRange.max);
      }
      // Give tasks new IDs to avoid key conflicts if loaded multiple times
      const tasksWithNewIds = template.tasks.map((task, index) => ({...task, id: `task-${Date.now()}-${index}`}));
      setTaskGroups([{ id: 'loaded-group', title: 'Tasks from Template', tasks: tasksWithNewIds }]);
      setIsGrouped(false);
      setStep('validate');
    }
  };

  const handleDeleteTemplate = (templateId: string) => {
    if(window.confirm("Are you sure you want to delete this template? This action cannot be undone.")){
      onDeleteTemplate(templateId);
    }
  };

  const renderCreationContent = () => {
    if (step === 'created' && createdSimulation) {
        return (
             <div className="bg-slate-800 p-6 rounded-lg border border-green-500/50 text-center animate-fade-in mb-8">
                <h3 className="text-2xl font-bold text-green-400">Simulation Created!</h3>
                <p className="text-slate-300 mt-2">Share the following ID with your candidate:</p>
                <div className="mt-4 bg-slate-900 p-4 rounded-md font-mono text-xl text-yellow-300 break-all">
                    {`${window.location.origin}${window.location.pathname}?simId=${createdSimulation.id}`}
                </div>
                 <button onClick={() => handleCopyToClipboard(createdSimulation.id, true)} className="mt-4 bg-slate-700 hover:bg-slate-600 text-white font-semibold py-2 px-4 rounded-md text-sm transition-colors">
                    {copiedId === createdSimulation.id ? 'Copied Link!' : 'Copy Shareable Link'}
                </button>
                <p className="text-slate-400 mt-4 text-sm">Note: If you close this browser tab, you can find this simulation in your history below.</p>
                <button onClick={() => {
                  setStep('form');
                  setJobTitle('');
                  setJobDescription('');
                  setTaskGroups([]);
                  setDurationMinutes(60);
                  setCallTimeMin(10);
                  setCallTimeMax(50);
                }} className="mt-6 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors">
                    Create Another Simulation
                </button>
            </div>
        )
    }

    if (step === 'validate') {
        return (
            <>
                {isPreviewing && (
                    <SimulationPreviewModal 
                        jobTitle={jobTitle}
                        tasks={allTasksForPreview}
                        onClose={() => setIsPreviewing(false)} 
                    />
                )}
                {showSaveTemplateModal && (
                    <SaveTemplateModal
                      name={templateName}
                      setName={setTemplateName}
                      description={templateDescription}
                      setDescription={setTemplateDescription}
                      onSave={handleConfirmSaveTemplate}
                      onCancel={() => setShowSaveTemplateModal(false)}
                    />
                )}
                <div className="bg-slate-800 p-8 rounded-lg border border-slate-700 relative animate-fade-in mb-8">
                    {loadingAction && (
                        <div className="absolute inset-0 bg-slate-800/80 flex flex-col items-center justify-center z-20 rounded-lg">
                            <SpinnerIcon className="w-8 h-8 text-blue-400" />
                            <p className="text-white text-lg mt-3">{loadingAction}</p>
                        </div>
                    )}
                    <h3 className="text-2xl font-bold mb-2">Validate & Refine Tasks</h3>
                    <p className="text-slate-400 mb-6">Drag and drop to reorder tasks. Use the controls to refine them, group them by skill, or use quick actions for broad changes.</p>
                    
                    {templateSaveSuccess && (
                        <div className="bg-green-500/10 border border-green-500/30 text-green-300 text-sm font-semibold p-3 rounded-md mb-4 flex items-center gap-2 animate-fade-in">
                            <CheckCircleIcon className="w-5 h-5" />
                            Template saved successfully!
                        </div>
                    )}

                    <div className="flex justify-start gap-2 mb-6">
                        {isGrouped ? (
                            <button onClick={handleUngroupTasks} disabled={!!loadingAction} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-md text-sm transition-colors disabled:opacity-50">Ungroup Tasks</button>
                        ) : (
                            <button onClick={handleGroupTasks} disabled={!!loadingAction || allTasksCount < 2} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-md text-sm transition-colors disabled:opacity-50">Group with AI</button>
                        )}
                    </div>

                    <div className="space-y-6 mb-6">
                        {taskGroups.map((group, groupIndex) => (
                            <div key={group.id} className="bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                                {isGrouped && <h4 className="text-lg font-semibold text-blue-300 mb-3">{group.title}</h4>}
                                <div className="space-y-3">
                                    {group.tasks.map((task, taskIndex) => (
                                        <div 
                                        key={task.id} 
                                        className={`relative bg-slate-900/70 p-4 rounded-md border border-slate-700 transition-opacity ${draggedItem?.taskIndex === taskIndex && draggedItem?.groupIndex === groupIndex ? 'opacity-30' : 'opacity-100'}`}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, { groupIndex, taskIndex })}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, { groupIndex, taskIndex })}
                                        >
                                            {taskSpecificLoading[task.id] && (
                                                <div className="absolute inset-0 bg-slate-900/80 flex flex-col items-center justify-center z-10 rounded-md">
                                                    <SpinnerIcon className="w-6 h-6 text-blue-400" />
                                                    <p className="mt-2 text-sm">{taskSpecificLoading[task.id]}</p>
                                                </div>
                                            )}
                                            <div className="flex justify-between items-start gap-4">
                                                <div className="flex items-start gap-3 flex-grow">
                                                    <div className="cursor-move text-slate-500 hover:text-white pt-1">
                                                        <DragHandleIcon className="w-5 h-5" />
                                                    </div>
                                                    <div className="flex-grow">
                                                        <div className="flex items-center gap-2">
                                                            <TaskTypeIcon type={task.type} />
                                                            <p className="font-semibold text-blue-300">Task {allTasksCount > 1 ? `${taskGroups.slice(0, groupIndex).flatMap((g: TaskGroup) => g.tasks).length + taskIndex + 1}:` : ''} {task.title}</p>
                                                        </div>
                                                        <p className="text-sm text-slate-400 mt-1 whitespace-pre-wrap">{task.description}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    <button onClick={() => handleChangeTaskDifficulty(task, groupIndex, taskIndex, 'increase')} title="Make Harder" className="p-2 text-slate-400 hover:bg-slate-700 hover:text-red-400 rounded-md transition-colors"><ChevronUpIcon className="w-5 h-5"/></button>
                                                    <button onClick={() => handleChangeTaskDifficulty(task, groupIndex, taskIndex, 'decrease')} title="Make Easier" className="p-2 text-slate-400 hover:bg-slate-700 hover:text-green-400 rounded-md transition-colors"><ChevronDownIcon className="w-5 h-5"/></button>
                                                    <button onClick={() => editingTaskId === task.id ? handleCancelEdit() : handleStartEdit(task)} title="Edit" className={`p-2 rounded-md transition-colors ${editingTaskId === task.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-700 hover:text-yellow-400'}`}><PencilIcon className="w-5 h-5"/></button>
                                                    <button onClick={() => handleRegenerateTask(task, groupIndex, taskIndex)} title="Regenerate" className="p-2 text-slate-400 hover:bg-slate-700 hover:text-blue-400 rounded-md transition-colors"><RefreshIcon className="w-5 h-5"/></button>
                                                    <button onClick={() => handleDeleteTask(groupIndex, taskIndex)} title="Delete" className="p-2 text-slate-400 hover:bg-slate-700 hover:text-red-500 rounded-md transition-colors"><TrashIcon className="w-5 h-5"/></button>
                                                </div>
                                            </div>
                                            
                                            <TaskAssetDisplay asset={task.asset} />

                                            {editingTaskId === task.id && (
                                                <div className="mt-4 pl-8 animate-fade-in">
                                                    <label className="text-sm font-medium text-slate-300">Modification Instruction:</label>
                                                    <textarea 
                                                        value={editInstruction}
                                                        onChange={(e) => setEditInstruction(e.target.value)}
                                                        placeholder="e.g., Make this task focus more on data analysis"
                                                        className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                                        rows={2}
                                                    />
                                                    <div className="flex justify-end gap-2 mt-2">
                                                        <button onClick={handleCancelEdit} className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded-md text-sm transition-colors">Cancel</button>
                                                        <button onClick={() => handleSaveChanges(task, groupIndex, taskIndex)} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-md text-sm transition-colors">Save Changes</button>
                                                    </div>
                                                </div>
                                            )}
                                            <div className="mt-4 pl-8">
                                                <div className="flex justify-between items-center mb-1">
                                                    <label className="text-sm font-medium text-slate-300">Evaluation Criteria (for AI analysis)</label>
                                                    <button
                                                      onClick={() => handleSuggestCriteria(task.id, task.title, task.description, groupIndex, taskIndex)}
                                                      disabled={criteriaLoadingTaskId === task.id}
                                                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:text-slate-500 disabled:cursor-wait"
                                                      title="Suggest criteria with AI"
                                                    >
                                                      {criteriaLoadingTaskId === task.id ? (
                                                        <>
                                                          <SpinnerIcon className="w-4 h-4" />
                                                          Generating...
                                                        </>
                                                      ) : (
                                                        <>
                                                          <SparklesIcon className="w-4 h-4" />
                                                          Suggest Criteria
                                                        </>
                                                      )}
                                                    </button>
                                                </div>
                                                <textarea
                                                    value={task.evaluationCriteria || ''}
                                                    onChange={(e) => handleCriteriaChange(groupIndex, taskIndex, e.target.value)}
                                                    placeholder="e.g., Score based on clarity of the marketing plan, feasibility of the budget, and identification of at least 3 target demographics."
                                                    className="block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                                    rows={2}
                                                />
                                                <p className="text-xs text-slate-500 mt-1">This criteria is only visible to you and the AI analyzer. It will not be shown to the candidate.</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    
                    {showCustomTaskForm ? (
                        <div className="bg-slate-900/70 p-4 rounded-md border border-blue-500/50 space-y-3 mb-6 animate-fade-in">
                            <h4 className="font-semibold text-blue-300">Add Custom Task</h4>
                            <div>
                                <label className="text-sm font-medium text-slate-300">Task Type</label>
                                <select
                                    value={customTaskType}
                                    onChange={(e) => setCustomTaskType(e.target.value as TaskType)}
                                    className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                >
                                    <option value={TaskType.TEXT}>Text Response</option>
                                    <option value={TaskType.IMAGE}>Image Upload</option>
                                    <option value={TaskType.AUDIO}>Audio Upload</option>
                                    <option value={TaskType.VIDEO}>Video Upload</option>
                                </select>
                            </div>
                            <input
                                type="text"
                                placeholder="Task Title"
                                value={customTaskTitle}
                                onChange={(e) => setCustomTaskTitle(e.target.value)}
                                className="block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            />
                            <textarea
                                placeholder="Task Description"
                                value={customTaskDescription}
                                onChange={(e) => setCustomTaskDescription(e.target.value)}
                                className="block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                rows={3}
                            />
                            <textarea
                                placeholder="Evaluation Criteria (Optional)"
                                value={customTaskCriteria}
                                onChange={(e) => setCustomTaskCriteria(e.target.value)}
                                className="block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                rows={2}
                            />
                            <div className="flex justify-end gap-2">
                                <button onClick={handleCancelCustomTask} className="px-3 py-1 bg-slate-600 hover:bg-slate-500 rounded-md text-sm transition-colors">Cancel</button>
                                <button onClick={handleSaveCustomTask} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded-md text-sm transition-colors">Save Task</button>
                            </div>
                        </div>
                    ) : (
                        <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <button onClick={handleAddNewTask} disabled={!!loadingAction} className="flex items-center justify-center gap-2 w-full px-4 py-2 border-2 border-dashed border-slate-600 hover:border-green-500 hover:text-green-400 rounded-md text-slate-400 text-sm transition-colors disabled:opacity-50">
                                <PlusIcon className="w-5 h-5"/>
                                Add AI-Generated Task
                            </button>
                            <button onClick={() => setShowCustomTaskForm(true)} disabled={!!loadingAction} className="flex items-center justify-center gap-2 w-full px-4 py-2 border-2 border-dashed border-slate-600 hover:border-blue-500 hover:text-blue-400 rounded-md text-slate-400 text-sm transition-colors disabled:opacity-50">
                                <PencilIcon className="w-5 h-5"/>
                                Add Custom Task
                            </button>
                        </div>
                    )}


                    <div className="grid grid-cols-2 gap-4 mb-6">
                        <button onClick={() => handleModifyTasks("Increase the number of tasks by one.")} disabled={!!loadingAction} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-md text-sm transition-colors disabled:opacity-50">More Questions</button>
                        <button onClick={() => handleModifyTasks("Decrease the number of tasks by one.")} disabled={!!loadingAction} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-md text-sm transition-colors disabled:opacity-50">Fewer Questions</button>
                    </div>

                    {error && <p className="text-red-400 text-sm mb-4 text-center">{error}</p>}

                    <div className="flex justify-between items-center border-t border-slate-700 pt-6 mt-6">
                        <button onClick={() => setStep('form')} className="text-slate-400 hover:text-white transition-colors">Back</button>
                        <div className="flex items-center gap-4">
                            <button 
                                onClick={() => setShowSaveTemplateModal(true)} 
                                className="py-3 px-6 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-md shadow-sm transition-colors flex items-center gap-2"
                                type="button"
                            >
                                <BookmarkIcon className="w-5 h-5"/>
                                Save as Template
                            </button>
                            <button 
                                onClick={() => setIsPreviewing(true)} 
                                className="py-3 px-6 bg-slate-600 hover:bg-slate-500 text-white font-bold rounded-md shadow-sm transition-colors"
                                type="button"
                            >
                                Preview
                            </button>
                            <button onClick={handleFinalizeSimulation} className="py-3 px-6 bg-green-600 hover:bg-green-700 text-white font-bold rounded-md shadow-sm transition-colors disabled:opacity-50" disabled={allTasksCount === 0}>
                                Finalize & Create Simulation ID
                            </button>
                        </div>
                    </div>
                </div>
            </>
        )
    }

    // Default step: 'form'
    return (
        <div className="relative mb-8 max-w-4xl mx-auto">
             <form onSubmit={handleGenerateTasks} className="space-y-6 bg-slate-800 p-8 rounded-lg border border-slate-700">
                <h2 className="text-2xl font-bold">Create New Simulation</h2>
                {loadingAction && (
                    <div className="absolute inset-0 bg-slate-800/80 flex flex-col items-center justify-center z-10 rounded-lg">
                        <SpinnerIcon className="w-10 h-10 text-blue-400" />
                        <p className="text-white text-lg mt-4">{loadingAction}</p>
                        <p className="text-slate-400 text-sm">This may take a moment.</p>
                    </div>
                )}
                <div>
                    <label htmlFor="jobTitle" className="block text-sm font-medium text-slate-300">Job Title</label>
                    <input
                        type="text"
                        id="jobTitle"
                        value={jobTitle}
                        onChange={(e) => setJobTitle(e.target.value)}
                        className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="e.g., Senior Product Manager"
                    />
                </div>
                <div>
                    <label htmlFor="jobDescription" className="block text-sm font-medium text-slate-300">Job Description</label>
                    <textarea
                        id="jobDescription"
                        rows={5}
                        value={jobDescription}
                        onChange={(e) => setJobDescription(e.target.value)}
                        className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Describe the key responsibilities and required skills for the role."
                    />
                </div>
                 <div>
                    <label htmlFor="duration" className="block text-sm font-medium text-slate-300">Simulation Duration (minutes)</label>
                    <input
                        type="number"
                        id="duration"
                        value={durationMinutes}
                        onChange={(e) => setDurationMinutes(Math.max(1, parseInt(e.target.value, 10)) || 1)}
                        className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        min="1"
                    />
                </div>
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-300">Enable Random Client Call?</span>
                    <label htmlFor="clientCallToggle" className="inline-flex relative items-center cursor-pointer">
                        <input 
                        type="checkbox" 
                        checked={clientCallEnabled}
                        onChange={() => setClientCallEnabled(!clientCallEnabled)}
                        id="clientCallToggle" 
                        className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-600 rounded-full peer peer-focus:ring-4 peer-focus:ring-blue-800 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                </div>
                {clientCallEnabled && (
                    <div className="p-4 bg-slate-700/50 rounded-md animate-fade-in space-y-3">
                        <p className="text-sm font-medium text-slate-300">Client Call Timing</p>
                        <div className="flex items-center gap-4">
                            <div className="flex-1">
                                <label htmlFor="callTimeMin" className="block text-xs text-slate-400">Trigger after (min)</label>
                                <input
                                    type="number"
                                    id="callTimeMin"
                                    value={callTimeMin}
                                    onChange={(e) => setCallTimeMin(parseInt(e.target.value, 10) || 0)}
                                    className="mt-1 block w-full bg-slate-600 border border-slate-500 rounded-md py-1 px-2 text-white text-sm"
                                    min="0"
                                    max={durationMinutes}
                                />
                            </div>
                            <div className="text-slate-400 pt-4">and before</div>
                            <div className="flex-1">
                                <label htmlFor="callTimeMax" className="block text-xs text-slate-400">Max (min)</label>
                                <input
                                    type="number"
                                    id="callTimeMax"
                                    value={callTimeMax}
                                    onChange={(e) => setCallTimeMax(parseInt(e.target.value, 10) || 0)}
                                    className="mt-1 block w-full bg-slate-600 border border-slate-500 rounded-md py-1 px-2 text-white text-sm"
                                    min={callTimeMin}
                                    max={durationMinutes}
                                />
                            </div>
                        </div>
                        {callTimeMax > durationMinutes && <p className="text-xs text-yellow-400">Max call time cannot exceed simulation duration.</p>}
                        {callTimeMin >= callTimeMax && <p className="text-xs text-yellow-400">"Trigger after" time must be less than "Max" time.</p>}
                    </div>
                )}
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <div>
                <button
                    type="submit"
                    disabled={!!loadingAction || !isFormValid}
                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-slate-500 disabled:cursor-not-allowed transition-colors"
                >
                    {loadingAction || 'Generate & Validate Tasks'}
                </button>
                </div>
            </form>
             <div className="mt-8">
                <h3 className="text-xl font-bold text-slate-300 border-b border-slate-700 pb-3 mb-4">Or Start from a Template</h3>
                {templates.length > 0 ? (
                    <div className="grid md:grid-cols-2 gap-4">
                        {templates.map(template => (
                            <div key={template.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700 flex flex-col justify-between">
                                <div>
                                    <p className="font-semibold text-white">{template.name}</p>
                                    <p className="text-sm text-slate-400 mt-1">{template.description || 'No description'}</p>
                                    <p className="text-xs text-slate-500 mt-2">{template.tasks.length} tasks ・ {template.durationMinutes} min</p>
                                </div>
                                <div className="flex gap-2 mt-4">
                                    <button onClick={() => handleLoadTemplate(template)} className="flex-grow px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-md hover:bg-blue-700 transition-colors">Load</button>
                                    <button onClick={() => handleDeleteTemplate(template.id)} title="Delete Template" className="p-2 bg-slate-700 text-slate-400 rounded-md hover:bg-red-600 hover:text-white transition-colors"><TrashIcon className="w-5 h-5" /></button>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-6 px-4 bg-slate-800/50 rounded-lg border-2 border-dashed border-slate-700">
                        <p className="text-slate-400">You have no saved templates.</p>
                        <p className="text-slate-500 text-sm mt-1">Save a configuration as a template after generating tasks.</p>
                    </div>
                )}
            </div>
        </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {renderCreationContent()}
      
      <div className="mt-12">
        <h3 className="text-2xl font-bold mb-6">Simulation History</h3>
        {previousSimulations.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {previousSimulations.map(sim => {
              const reportsForSim = Object.values(completedReports).filter(r => r.simulationId === sim.id);
              const completionCount = reportsForSim.length;
              return (
                <div key={sim.id} className="bg-slate-800 rounded-lg border border-slate-700 p-5 flex flex-col justify-between">
                  <div>
                    <p className="font-bold text-lg text-blue-300">{sim.jobTitle}</p>
                    <div className="text-sm text-slate-400 mt-2 flex flex-col gap-1">
                        <span className="flex items-center gap-1.5"><CalendarIcon className="w-4 h-4" /> Created: {new Date(sim.createdAt).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1.5 text-green-400">
                          <CheckCircleIcon className="w-4 h-4" /> 
                          {completionCount} {completionCount === 1 ? 'Completion' : 'Completions'}
                        </span>
                    </div>
                    <div className="mt-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-md">
                            <span className="font-mono text-xs text-slate-400 flex-shrink-0">ID:</span>
                            <input type="text" readOnly value={sim.id} className="font-mono text-xs text-yellow-300 bg-transparent w-full focus:outline-none" />
                            <button onClick={() => handleCopyToClipboard(sim.id)} title="Copy ID" className="p-1 text-slate-400 hover:text-white transition-colors">
                                <ClipboardIcon className="w-4 h-4" />
                            </button>
                        </div>
                        <button onClick={() => handleCopyToClipboard(sim.id, true)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors">
                            <ClipboardIcon className="w-3 h-3" />
                            {copiedId === sim.id ? 'Link Copied!' : 'Copy Shareable Link'}
                        </button>
                    </div>
                  </div>
                  {completionCount > 0 && (
                     <button onClick={() => onSwitchTab('analytics')} className="mt-4 w-full text-center bg-blue-600/20 text-blue-300 border border-blue-500/50 hover:bg-blue-600/40 font-semibold py-2 px-4 rounded-md text-sm transition-colors">
                        View Analytics
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
            <div className="text-center py-10 px-6 bg-slate-800 rounded-lg border-2 border-dashed border-slate-700">
                <p className="text-slate-400">You haven't created any simulations yet.</p>
                <p className="text-slate-500 text-sm mt-2">Use the form above to get started.</p>
            </div>
        )}
      </div>
    </div>
  );
};

interface SaveTemplateModalProps {
  name: string;
  setName: (name: string) => void;
  description: string;
  setDescription: (desc: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

const SaveTemplateModal: React.FC<SaveTemplateModalProps> = ({ name, setName, description, setDescription, onSave, onCancel }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 backdrop-blur-sm animate-fade-in">
            <div className="bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4 border border-slate-700 transform transition-all duration-300">
                <h3 className="text-xl font-bold text-white mb-4">Save as Template</h3>
                <div className="space-y-4">
                    <div>
                        <label htmlFor="templateName" className="block text-sm font-medium text-slate-300">Template Name</label>
                        <input
                            type="text"
                            id="templateName"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            placeholder="e.g., Senior Frontend Engineer"
                        />
                    </div>
                    <div>
                        <label htmlFor="templateDescription" className="block text-sm font-medium text-slate-300">Description (Optional)</label>
                        <textarea
                            id="templateDescription"
                            rows={3}
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="mt-1 block w-full bg-slate-700 border border-slate-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            placeholder="A brief description of this template"
                        />
                    </div>
                </div>
                <div className="mt-6 flex justify-end gap-3">
                    <button onClick={onCancel} className="px-4 py-2 bg-slate-600 text-white font-semibold rounded-lg hover:bg-slate-700 transition-colors">
                        Cancel
                    </button>
                    <button onClick={onSave} className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                        Save Template
                    </button>
                </div>
            </div>
        </div>
    );
};


const AnalyticsView: React.FC<{ simulations: Simulation[], reports: PerformanceReport[], onViewReport: (report: PerformanceReport) => void }> = ({ simulations, reports, onViewReport }) => {
    const [filterText, setFilterText] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

    const analyticsData = useMemo(() => {
        const totalSims = simulations.length;
        const totalReports = reports.length;
        const completionRate = totalSims > 0 ? (totalReports / totalSims) * 100 : 0;
        
        const avgProblemSolving = reports.reduce((acc, r) => acc + r.problemSolvingScore, 0) / (totalReports || 1);
        const avgCommunication = reports.reduce((acc, r) => acc + r.communicationScore, 0) / (totalReports || 1);
        const avgStress = reports.reduce((acc, r) => acc + r.stressManagementScore, 0) / (totalReports || 1);
        const overallAvgScore = (avgProblemSolving + avgCommunication + avgStress) / 3;

        const scoreDistribution = reports.reduce((acc, r) => {
            const avg = (r.problemSolvingScore + r.communicationScore + r.stressManagementScore) / 3;
            if (avg >= 8) acc.high++;
            else if (avg >= 5) acc.medium++;
            else acc.low++;
            return acc;
        }, { high: 0, medium: 0, low: 0 });

        const detailedReports = reports.map(report => {
            const sim = simulations.find(s => s.id === report.simulationId);
            const overallScore = (report.problemSolvingScore + report.communicationScore + report.stressManagementScore) / 3;
            return { ...report, jobTitle: sim?.jobTitle || 'N/A', overallScore };
        });

        return {
            totalSims,
            totalReports,
            completionRate,
            overallAvgScore,
            scoreDistribution,
            detailedReports,
        };
    }, [simulations, reports]);

    const filteredAndSortedReports = useMemo(() => {
        let sortableItems = [...analyticsData.detailedReports];
        if (filterText) {
            sortableItems = sortableItems.filter(item =>
                item.candidateName.toLowerCase().includes(filterText.toLowerCase()) ||
                item.jobTitle.toLowerCase().includes(filterText.toLowerCase())
            );
        }
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                const aValue = a[sortConfig.key as keyof typeof a];
                const bValue = b[sortConfig.key as keyof typeof b];
                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sortableItems;
    }, [analyticsData.detailedReports, filterText, sortConfig]);

    const requestSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };
    
    if (simulations.length === 0) {
      return (
        <div className="text-center py-16 px-6 bg-slate-800 rounded-lg border-2 border-dashed border-slate-700 animate-fade-in">
          <ChartBarIcon className="w-12 h-12 mx-auto text-slate-500 mb-4" />
          <h3 className="text-xl font-bold text-slate-300">No Analytics Yet</h3>
          <p className="text-slate-400 mt-2">Create a simulation and wait for a candidate to complete it to see analytics here.</p>
        </div>
      );
    }
    
    return (
        <div className="space-y-8 animate-fade-in">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <KpiCard icon={<CollectionIcon className="w-8 h-8 text-blue-400"/>} title="Total Simulations" value={analyticsData.totalSims} />
                <KpiCard icon={<CheckBadgeIcon className="w-8 h-8 text-green-400"/>} title="Completion Rate" value={`${analyticsData.completionRate.toFixed(1)}%`} />
                <KpiCard icon={<AcademicCapIcon className="w-8 h-8 text-yellow-400"/>} title="Avg. Candidate Score" value={analyticsData.overallAvgScore.toFixed(1)} suffix="/ 10" />
                <KpiCard icon={<ClockIcon className="w-8 h-8 text-indigo-400"/>} title="Completed Sims" value={analyticsData.totalReports} />
            </div>

            {/* Charts */}
            {reports.length > 0 && (
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                    <h3 className="text-lg font-bold mb-4">Overall Performance Distribution</h3>
                    <PerformanceChart data={analyticsData.scoreDistribution} total={analyticsData.totalReports} />
                </div>
            )}

            {/* Detailed Table */}
            <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold">Completed Simulation Reports</h3>
                    <input
                        type="text"
                        placeholder="Search by name or job..."
                        value={filterText}
                        onChange={e => setFilterText(e.target.value)}
                        className="bg-slate-700 border border-slate-600 rounded-md py-1.5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                </div>
                 <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-400 uppercase bg-slate-700/50">
                            <tr>
                                <th scope="col" className="p-3 cursor-pointer" onClick={() => requestSort('candidateName')}>Candidate</th>
                                <th scope="col" className="p-3 cursor-pointer" onClick={() => requestSort('jobTitle')}>Job Title</th>
                                <th scope="col" className="p-3 cursor-pointer" onClick={() => requestSort('completedAt')}>Date</th>
                                <th scope="col" className="p-3 cursor-pointer" onClick={() => requestSort('overallScore')}>Overall Score</th>
                                <th scope="col" className="p-3"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredAndSortedReports.map(report => (
                                <tr key={`${report.simulationId}-${report.candidateEmail}`} className="border-b border-slate-700 hover:bg-slate-700/40">
                                    <td className="p-3 font-medium text-white">{report.candidateName}</td>
                                    <td className="p-3 text-slate-300">{report.jobTitle}</td>
                                    <td className="p-3 text-slate-300">{new Date(report.completedAt).toLocaleDateString()}</td>
                                    <td className="p-3 font-semibold text-blue-300">{report.overallScore.toFixed(1)} / 10</td>
                                    <td className="p-3 text-right">
                                        <button onClick={() => onViewReport(report)} className="font-medium text-blue-400 hover:underline">View Report</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {filteredAndSortedReports.length === 0 && (
                        <p className="text-center text-slate-400 py-8">No matching reports found.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

const KpiCard: React.FC<{ icon: React.ReactNode, title: string, value: string | number, suffix?: string }> = ({ icon, title, value, suffix }) => (
    <div className="bg-slate-800 p-5 rounded-lg border border-slate-700 flex items-center gap-5">
        <div className="flex-shrink-0 bg-slate-700/50 p-3 rounded-full">
            {icon}
        </div>
        <div>
            <p className="text-sm text-slate-400">{title}</p>
            <p className="text-2xl font-bold text-white">{value}<span className="text-base text-slate-400 font-medium">{suffix}</span></p>
        </div>
    </div>
);

const PerformanceChart: React.FC<{ data: { high: number, medium: number, low: number }, total: number }> = ({ data, total }) => {
    const bars = [
        { label: 'Low (0-4.9)', value: data.low, color: 'bg-red-500' },
        { label: 'Medium (5-7.9)', value: data.medium, color: 'bg-yellow-500' },
        { label: 'High (8-10)', value: data.high, color: 'bg-green-500' }
    ];
    return (
        <div className="space-y-3">
            {bars.map(bar => (
                <div key={bar.label} className="flex items-center gap-4">
                    <span className="text-xs text-slate-400 w-24 text-right">{bar.label}</span>
                    <div className="w-full bg-slate-700 rounded-full h-4">
                        <div className={`${bar.color} h-4 rounded-full`} style={{ width: total > 0 ? `${(bar.value / total) * 100}%` : '0%' }}></div>
                    </div>
                    <span className="text-sm font-semibold text-white">{bar.value}</span>
                </div>
            ))}
        </div>
    );
};


export default RecruiterDashboard;