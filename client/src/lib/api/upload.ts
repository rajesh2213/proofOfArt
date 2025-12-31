import { ImageMetaData } from '../../components/UploadDialog';

export const uploadImage = async (file: File, imageMetaData: ImageMetaData, claimEvidenceMetadata?: any, onProgress?: (progress: number) => void, action: 'insert' | 'update' = 'insert') => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('imageMetaData', JSON.stringify(imageMetaData));
    formData.append('action', action);
    if (claimEvidenceMetadata) {
        formData.append('claimEvidenceMetadata', JSON.stringify(claimEvidenceMetadata))
    }
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable && onProgress) {
                const percent = Math.round((e.loaded / e.total) * 100) 
                onProgress(percent)
            }
        })

        xhr.onload = () => {
            if (xhr.status === 200) {
                try {
                    resolve(JSON.parse(xhr.responseText))
                } catch (err) {
                    reject(new Error('Invalid response format'))
                } 
            } else {
                reject(new Error(`Upload failed with status ${xhr.status}`))
            }
        }

        xhr.onerror = () => reject(new Error('Network error'))
        
        xhr.open('POST', `${process.env.NEXT_PUBLIC_AI_URL || 'http://localhost:4000'}/api/upload`)
        
        const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
        if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }
        
        xhr.send(formData)
    })
}