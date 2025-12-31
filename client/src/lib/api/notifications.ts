const API_BASE_URL = process.env.NEXT_PUBLIC_AI_URL || 'http://localhost:4000';

async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    
    if (!token) {
        throw new Error('No authentication token found. Please log in.');
    }
    
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers as Record<string, string> || {}),
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
        credentials: 'include',
    });

    if (!response.ok) {
        if (response.status === 401) {
            try {
                const refreshResponse = await fetch(`${API_BASE_URL}/api/auth/refresh-token`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    credentials: 'include',
                });
                
                if (refreshResponse.ok) {
                    const refreshData = await refreshResponse.json();
                    if (refreshData.accessToken) {
                        localStorage.setItem('accessToken', refreshData.accessToken);
                        const retryHeaders: Record<string, string> = {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${refreshData.accessToken}`,
                            ...(options.headers as Record<string, string> || {}),
                        };
                        const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
                            ...options,
                            headers: retryHeaders,
                            credentials: 'include',
                        });
                        if (retryResponse.ok) {
                            return retryResponse.json();
                        }
                    }
                }
                } catch (refreshError) {
                    localStorage.removeItem('accessToken');
                throw new Error('Session expired. Please log in again.');
            }
        }
        
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }

    return response.json();
}

export interface Notification {
    id: string;
    userId: string;
    type: string;
    title: string;
    message: string;
    artworkId: string | null;
    claimId: string | null;
    read: boolean;
    createdAt: string;
}

export const getNotifications = async (limit = 50, offset = 0, unreadOnly = false) => {
    return apiRequest<{ success: boolean; data: { notifications: Notification[] } }>(
        `/api/notifications?limit=${limit}&offset=${offset}&unreadOnly=${unreadOnly}`
    );
};

export const getUnreadCount = async () => {
    return apiRequest<{ success: boolean; data: { unreadCount: number } }>(
        `/api/notifications/unread-count`
    );
};

export const markAsRead = async (notificationId: string) => {
    return apiRequest<{ success: boolean }>(
        `/api/notifications/${notificationId}/read`,
        {
            method: 'POST',
        }
    );
};

export const markAllAsRead = async () => {
    return apiRequest<{ success: boolean; data: { markedCount: number } }>(
        `/api/notifications/mark-all-read`,
        {
            method: 'POST',
        }
    );
};

export const deleteNotification = async (notificationId: string) => {
    return apiRequest<{ success: boolean }>(
        `/api/notifications/${notificationId}`,
        {
            method: 'DELETE',
        }
    );
};

