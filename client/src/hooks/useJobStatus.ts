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
        tampering?: {
            detected: boolean;
            mask_base64: string | null;
            edited_area_ratio: number;
            edited_pixels: number;
        };
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
    /** First wait after the initial poll (ms). Backoff grows from here. */
    initialInterval?: number;
    maxInterval?: number;
    backoffMultiplier?: number;
    onStatusChange?: (status: JobStatus) => void;
    onComplete?: (data: JobStatusResponse['data']) => void;
    onError?: (error: Error) => void;
}

const TERMINAL: ReadonlySet<JobStatus> = new Set(['complete', 'failed']);

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

    const statusRef = useRef<JobStatus>('pending');
    const onStatusChangeRef = useRef(onStatusChange);
    const onCompleteRef = useRef(onComplete);
    const onErrorRef = useRef(onError);

    useEffect(() => {
        onStatusChangeRef.current = onStatusChange;
        onCompleteRef.current = onComplete;
        onErrorRef.current = onError;
    }, [onStatusChange, onComplete, onError]);

    useEffect(() => {
        if (!imageId || !enabled) {
            setIsPolling(false);
            return;
        }

        let cancelled = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let interval = initialInterval;

        statusRef.current = 'pending';
        setStatus('pending');
        setProgress(0);
        setError(null);
        setIsPolling(true);

        const clearTimer = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        const scheduleNext = () => {
            clearTimer();
            if (cancelled || TERMINAL.has(statusRef.current)) {
                setIsPolling(false);
                return;
            }
            timeoutId = setTimeout(() => {
                void poll();
            }, interval);
            interval = Math.min(interval * backoffMultiplier, maxInterval);
        };

        const poll = async () => {
            if (cancelled || !imageId) return;

            try {
                const response = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/progress/image/${imageId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
                        },
                        credentials: 'include',
                    }
                );

                if (!response.ok) {
                    throw new Error(`Failed to fetch job status: ${response.statusText}`);
                }

                const result: JobStatusResponse = await response.json();

                if (cancelled) return;

                if (result.success && result.data) {
                    const newStatus = result.data.status;
                    const newProgress = result.data.progress || 0;
                    const prevStatus = statusRef.current;

                    statusRef.current = newStatus;
                    setStatus(newStatus);
                    setProgress(newProgress);
                    setData(result.data);
                    setError(null);

                    if (onStatusChangeRef.current && newStatus !== prevStatus) {
                        onStatusChangeRef.current(newStatus);
                    }

                    if (TERMINAL.has(newStatus)) {
                        setIsPolling(false);
                        clearTimer();
                        if (newStatus === 'complete' && onCompleteRef.current) {
                            onCompleteRef.current(result.data);
                        }
                        return;
                    }

                    setIsPolling(true);
                    scheduleNext();
                    return;
                }
            } catch (err) {
                if (cancelled) return;
                const nextError = err instanceof Error ? err : new Error('Unknown error');
                setError(nextError);
                onErrorRef.current?.(nextError);
                scheduleNext();
                return;
            }

            scheduleNext();
        };

        // Immediate first poll, then backoff from initialInterval
        void poll();

        return () => {
            cancelled = true;
            clearTimer();
            setIsPolling(false);
        };
    }, [imageId, enabled, initialInterval, maxInterval, backoffMultiplier]);

    const retry = useCallback(() => {
        if (!imageId) return;
        statusRef.current = 'pending';
        setStatus('pending');
        setError(null);
        setIsPolling(true);
        // Re-trigger effect by toggling is a no-op; callers remount/enable. Force one poll:
        void (async () => {
            try {
                const response = await fetch(
                    `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/progress/image/${imageId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
                        },
                        credentials: 'include',
                    }
                );
                if (!response.ok) throw new Error(`Failed to fetch job status: ${response.statusText}`);
                const result: JobStatusResponse = await response.json();
                if (result.success && result.data) {
                    statusRef.current = result.data.status;
                    setStatus(result.data.status);
                    setProgress(result.data.progress || 0);
                    setData(result.data);
                    if (TERMINAL.has(result.data.status)) {
                        setIsPolling(false);
                        if (result.data.status === 'complete') {
                            onCompleteRef.current?.(result.data);
                        }
                    }
                }
            } catch (err) {
                const nextError = err instanceof Error ? err : new Error('Unknown error');
                setError(nextError);
                onErrorRef.current?.(nextError);
            }
        })();
    }, [imageId]);

    return {
        status,
        progress,
        data,
        error,
        isPolling,
        retry,
    };
}
