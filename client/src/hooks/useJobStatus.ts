import { useState, useEffect, useRef, useCallback } from 'react';

export type JobStatus = 'pending' | 'processing' | 'complete' | 'failed';

export interface JobStatusResponse {
    success: boolean;
    data: {
        imageId: string;
        status: JobStatus;
        progress?: number;
        hasDetectionReport?: boolean;
        result?: {
            aiProbability: number;
            detectedLabel: string;
            modelName?: string;
            hasHeatmap?: boolean;
        } | null;
        jobStatus?: {
            state: string;
            progress?: number;
            attemptsMade?: number;
        } | null;
        url?: string;
        createdAt?: string;
    };
}

interface UseJobStatusOptions {
    imageId: string | null;
    enabled?: boolean;
    initialInterval?: number;
    maxInterval?: number;
    backoffMultiplier?: number;
    onStatusChange?: (status: JobStatus) => void;
    onComplete?: (data: JobStatusResponse['data']) => void;
    onError?: (error: Error) => void;
}

export function useJobStatus({
    imageId,
    enabled = true,
    initialInterval = 2000,
    maxInterval = 30000,
    backoffMultiplier = 1.5,
    onStatusChange,
    onComplete,
    onError,
}: UseJobStatusOptions) {
    const [status, setStatus] = useState<JobStatus>('pending');
    const [progress, setProgress] = useState<number>(0);
    const [data, setData] = useState<JobStatusResponse['data'] | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [isPolling, setIsPolling] = useState(false);

    const intervalRef = useRef<number | null>(null);
    const currentIntervalRef = useRef<number>(initialInterval);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const poll = useCallback(async () => {
        if (!imageId || !enabled) {
            return;
        }

        try {
            const response = await fetch(
                `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/progress/image/${imageId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('accessToken') || ''}`,
                    },
                    credentials: 'include',
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch job status: ${response.statusText}`);
            }

            const result: JobStatusResponse = await response.json();

            if (result.success && result.data) {
                const newStatus = result.data.status;
                const newProgress = result.data.progress || 0;

                setStatus(newStatus);
                setProgress(newProgress);
                setData(result.data);
                setError(null);

                if (onStatusChange && newStatus !== status) {
                    onStatusChange(newStatus);
                }

                if (newStatus === 'complete' || newStatus === 'failed') {
                    setIsPolling(false);
                    if (intervalRef.current) {
                        clearInterval(intervalRef.current);
                        intervalRef.current = null;
                    }
                    if (timeoutRef.current) {
                        clearTimeout(timeoutRef.current);
                        timeoutRef.current = null;
                    }

                    if (newStatus === 'complete' && onComplete) {
                        onComplete(result.data);
                    }
                } else {
                    setIsPolling(true);
                    currentIntervalRef.current = Math.min(
                        currentIntervalRef.current * backoffMultiplier,
                        maxInterval
                    );
                }
            }
        } catch (err) {
            const error = err instanceof Error ? err : new Error('Unknown error');
            setError(error);
            if (onError) {
                onError(error);
            }
            currentIntervalRef.current = Math.min(
                currentIntervalRef.current * backoffMultiplier,
                maxInterval
            );
        }
    }, [imageId, enabled, onStatusChange, onComplete, onError, backoffMultiplier, maxInterval, status]);

    useEffect(() => {
        if (!imageId || !enabled) {
            setIsPolling(false);
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
            return;
        }

        currentIntervalRef.current = initialInterval;
        setIsPolling(true);

        poll();

        const scheduleNextPoll = () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            timeoutRef.current = setTimeout(() => {
                if (imageId && enabled && (status === 'pending' || status === 'processing')) {
                    poll();
                    scheduleNextPoll();
                } else {
                    setIsPolling(false);
                }
            }, currentIntervalRef.current);
        };

        scheduleNextPoll();

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        };
    }, [imageId, enabled, poll, initialInterval, status]);

    const retry = useCallback(() => {
        if (imageId) {
            currentIntervalRef.current = initialInterval;
            setError(null);
            setIsPolling(true);
            poll();
        }
    }, [imageId, initialInterval, poll]);

    return {
        status,
        progress,
        data,
        error,
        isPolling,
        retry,
    };
}

