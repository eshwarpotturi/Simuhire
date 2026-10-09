import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getClientCallResponse } from '../services/aiService';
import { PhoneIcon } from './Icons';
import { LoggedEvent } from '../types';

interface ClientCallModalProps {
  jobTitle: string;
  onClose: (transcript: string) => void;
  logEvent: (type: LoggedEvent['type'], details?: LoggedEvent['details']) => void;
}

export const ClientCallModal: React.FC<ClientCallModalProps> = ({ jobTitle, onClose, logEvent }) => {
  const [status, setStatus] = useState<'ringing' | 'connected' | 'ended'>('ringing');
  const [transcript, setTranscript] = useState<{ author: 'Client' | 'You', text: string }[]>([]);
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const endCall = useCallback(() => {
    logEvent('CLIENT_CALL_END');
    setStatus('ended');
    const finalTranscript = transcript.map(t => `${t.author}: ${t.text}`).join('\n');
    setTimeout(() => onClose(finalTranscript), 1500);
  }, [transcript, onClose, logEvent]);

  const startCall = useCallback(async () => {
    logEvent('CLIENT_CALL_START');
    setStatus('connected');
    setIsAiTyping(true);
    const initialHistory: { author: 'Client' | 'You', text: string }[] = [{ author: 'You', text: "(Answers the call)" }];
    try {
        const firstResponse = await getClientCallResponse(jobTitle, initialHistory);
        setTranscript([{ author: 'Client', text: firstResponse }]);
    } catch (error) {
        console.error("Client call error:", error);
        setTranscript([{ author: 'Client', text: "Sorry, I'm having trouble connecting. We'll have to try again later." }]);
    } finally {
        setIsAiTyping(false);
    }
  }, [jobTitle, logEvent]);
  
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isAiTyping) return;

    const userMessage = { author: 'You' as const, text: input.trim() };
    const newHistory = [...transcript, userMessage];
    
    setTranscript(newHistory);
    setInput('');
    setIsAiTyping(true);

    try {
        const aiResponse = await getClientCallResponse(jobTitle, newHistory);
        const aiMessage = { author: 'Client' as const, text: aiResponse };
        setTranscript(prev => [...prev, aiMessage]);
    } catch (error) {
        console.error("Client call response error:", error);
        const errorMessage = { author: 'Client' as const, text: "Apologies, my connection seems to be unstable. Can you repeat that?" };
        setTranscript(prev => [...prev, errorMessage]);
    } finally {
        setIsAiTyping(false);
    }
  };
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, isAiTyping]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4 transform transition-all duration-300">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-blue-500 animate-pulse mb-4">
            <PhoneIcon className="h-8 w-8 text-white" />
          </div>
          <h3 className="text-2xl font-semibold text-white">Incoming Client Call</h3>
          <p className="text-slate-400 mt-2">Alex - Veridian Project</p>
        </div>

        {status === 'ringing' && (
          <div className="mt-8 flex justify-around">
            <button
              onClick={startCall}
              className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors duration-200"
            >
              Answer
            </button>
            <button
              onClick={() => onClose('Candidate rejected the call.')}
              className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors duration-200"
            >
              Decline
            </button>
          </div>
        )}

        {status === 'connected' && (
          <div className="mt-6">
            <div className="h-64 bg-slate-900/50 rounded-lg p-3 overflow-y-auto space-y-3">
              {transcript.map((entry, index) => (
                <div key={index} className={`flex ${entry.author === 'You' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`px-3 py-2 rounded-lg max-w-[80%] ${entry.author === 'You' ? 'bg-blue-600' : 'bg-slate-700'}`}>
                    <p className="text-sm">{entry.text}</p>
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
            <form onSubmit={handleSend} className="mt-4 flex gap-2">
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Type your response..."
                    className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={isAiTyping}
                />
                <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:bg-slate-500" disabled={isAiTyping || !input.trim()}>
                    Send
                </button>
            </form>
            <button
              onClick={endCall}
              className="mt-4 w-full px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors duration-200"
            >
              End Call
            </button>
          </div>
        )}

        {status === 'ended' && (
          <div className="mt-6 text-center">
            <p className="text-lg text-slate-300">Call Ended</p>
          </div>
        )}
      </div>
    </div>
  );
};