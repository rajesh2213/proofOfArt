import multer from 'multer';

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only images (jpg, png, jpeg) are allowed'));
    }
};

const uploads = multer({
    storage: multer.memoryStorage(), 
    fileFilter: fileFilter,
    limits: { fileSize: 100 * 1024 * 1024 }
});

export default uploads;
