import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useAppStore } from '../store/state';
function App() {
    const { status, sessionId, errorMessage, setStatus, setSessionId, setError, setRecording } = useAppStore();
    const [isProcessing, setIsProcessing] = useState(false);
    useEffect(() => {
        // Get initial status from service worker
        const updateStatus = () => {
            chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Error getting status:', chrome.runtime.lastError);
                    return;
                }
                if (response && response.status) {
                    console.log('Got status from service worker:', response.status);
                    setStatus(response.status);
                    if (response.sessionId) {
                        setSessionId(response.sessionId);
                    }
                    else {
                        setSessionId(null);
                    }
                    setRecording(response.status === 'recording');
                }
            });
        };
        // Get status immediately
        updateStatus();
        // Also refresh status periodically (every 2 seconds) to catch any missed updates
        // This ensures popup always shows correct status even if messages are missed
        const statusInterval = setInterval(updateStatus, 2000);
        // Listen for status updates from service worker
        const messageListener = (message) => {
            console.log('Popup received message:', message.type, message.status);
            if (message.type === 'STATUS_UPDATE') {
                setStatus(message.status);
                if (message.sessionId) {
                    setSessionId(message.sessionId);
                }
                else {
                    setSessionId(null);
                }
                if (message.status === 'recording') {
                    setRecording(true);
                    // Clear error when recording starts successfully
                    setError(null);
                }
                else {
                    setRecording(false);
                }
            }
            else if (message.type === 'ERROR') {
                setError(message.message);
            }
        };
        chrome.runtime.onMessage.addListener(messageListener);
        return () => {
            clearInterval(statusInterval);
            chrome.runtime.onMessage.removeListener(messageListener);
        };
    }, []);
    const handleStart = async () => {
        setError(null);
        setIsProcessing(true);
        try {
            // Get active tab first
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tabs[0]?.id) {
                setError('No active tab found');
                setIsProcessing(false);
                return;
            }
            const tabId = tabs[0].id;
            // Get streamId in popup (fast, requires user action context)
            const streamId = await new Promise((resolve, reject) => {
                chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
                    if (chrome.runtime.lastError || !id) {
                        reject(new Error(chrome.runtime.lastError?.message || 'Failed to get media stream ID'));
                        return;
                    }
                    resolve(id);
                });
            });
            // Send streamId to service worker
            // Service worker will connect to WebSocket if needed and start recording
            chrome.runtime.sendMessage({ type: 'START_RECORDING', streamId }, (response) => {
                setIsProcessing(false);
                if (response && response.error) {
                    setError(response.error);
                }
                else {
                    // Clear any previous errors on success
                    setError(null);
                }
            });
        }
        catch (err) {
            setIsProcessing(false);
            setError(err.message);
        }
    };
    const handleStop = () => {
        setIsProcessing(true);
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
            setIsProcessing(false);
            if (response.error) {
                setError(response.error);
            }
        });
    };
    const getStatusColor = () => {
        switch (status) {
            case 'recording':
                return 'bg-red-500 animate-pulse';
            case 'error':
                return 'bg-red-600';
            default:
                return 'bg-gray-400';
        }
    };
    const getStatusText = () => {
        switch (status) {
            case 'recording':
                return 'Recording';
            case 'error':
                return 'Error';
            default:
                return 'Ready';
        }
    };
    return (_jsxs("div", { className: "w-80 p-4 bg-gray-50", children: [_jsxs("div", { className: "mb-4", children: [_jsx("h1", { className: "text-2xl font-bold text-gray-800", children: "LiveScribe" }), _jsx("p", { className: "text-sm text-gray-600", children: "Real-time transcription" })] }), _jsxs("div", { className: "mb-4 flex items-center gap-2", children: [_jsx("div", { className: `w-3 h-3 rounded-full ${getStatusColor()}` }), _jsx("span", { className: "text-sm font-medium text-gray-700", children: getStatusText() })] }), errorMessage && (_jsx("div", { className: "mb-4 p-3 bg-red-100 border border-red-300 rounded text-sm text-red-700", children: errorMessage })), sessionId && (_jsxs("div", { className: "mb-4 p-2 bg-blue-50 rounded text-xs text-gray-600", children: ["Session: ", sessionId.slice(0, 8), "..."] })), _jsxs("div", { className: "space-y-2", children: [status !== 'recording' && (_jsx("button", { onClick: handleStart, disabled: isProcessing, className: "w-full py-2 px-4 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white rounded font-medium transition-colors", children: isProcessing ? 'Starting...' : 'Start Recording' })), status === 'recording' && (_jsx("button", { onClick: handleStop, disabled: isProcessing, className: "w-full py-2 px-4 bg-red-500 hover:bg-red-600 disabled:bg-gray-400 text-white rounded font-medium transition-colors", children: isProcessing ? 'Stopping...' : 'Stop Recording' }))] }), _jsx("div", { className: "mt-4 pt-4 border-t border-gray-200", children: _jsxs("p", { className: "text-xs text-gray-500 text-center", children: ["Make sure backend is running on", _jsx("br", {}), _jsx("code", { className: "text-xs bg-gray-200 px-1 rounded", children: "ws://localhost:3001" })] }) })] }));
}
export default App;
//# sourceMappingURL=App.js.map