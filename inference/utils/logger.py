"""
Centralized logging utility for training scripts.
Captures all stdout/stderr output to both console and log file.
"""
import sys
import atexit
from pathlib import Path
from datetime import datetime
from contextlib import contextmanager
from typing import Optional


class TeeOutput:
    """Class to write output to both console and file"""
    def __init__(self, *files):
        self.files = files
    
    def write(self, obj):
        for f in self.files:
            f.write(obj)
            f.flush()
    
    def flush(self):
        for f in self.files:
            f.flush()


class FileLogger:
    """Manages file logging with automatic cleanup"""
    
    def __init__(self, log_dir: Path, log_filename: str):
        self.log_dir = log_dir
        self.log_filename = log_filename
        self.log_file = None
        self.original_stdout = None
        self.original_stderr = None
        self.log_path = None
    
    def start(self):
        """Start logging to file"""
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.log_path = self.log_dir / self.log_filename
        
        # Open in append mode so multiple runs on the same day append to the same file
        file_exists = self.log_path.exists()
        self.log_file = open(self.log_path, 'a', encoding='utf-8')
        
        # Add separator if file already exists (not the first run of the day)
        if file_exists:
            self.log_file.write("\n" + "=" * 60 + "\n")
            self.log_file.write(f"New run started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            self.log_file.write("=" * 60 + "\n\n")
            self.log_file.flush()
        
        self.original_stdout = sys.stdout
        self.original_stderr = sys.stderr
        
        sys.stdout = TeeOutput(sys.stdout, self.log_file)
        sys.stderr = TeeOutput(sys.stderr, self.log_file)
        
        print(f"Logging all output to: {self.log_path}")
        if file_exists:
            print(f"(Appending to existing log file for today)")
        print("=" * 60)
        
        return self
    
    def stop(self):
        """Stop logging and restore stdout/stderr"""
        if self.log_file and not self.log_file.closed:
            print("\n" + "=" * 60)
            print(f"Logging completed. All logs saved to: {self.log_path}")
            print("=" * 60)
            self.log_file.flush()
            sys.stdout = self.original_stdout
            sys.stderr = self.original_stderr
            self.log_file.close()
    
    def __enter__(self):
        """Context manager entry"""
        self.start()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit"""
        self.stop()
        return False


def setup_file_logging(
    log_dir: Optional[Path] = None,
    log_filename: Optional[str] = None,
    subdirectory: str = "logs"
) -> FileLogger:
    """
    Set up file logging that captures all stdout/stderr to both console and file.
    
    Args:
        log_dir: Base directory for logs. If None, uses "core/models/ai_detection/logs"
        log_filename: Name of log file. If None, generates timestamped filename
        subdirectory: Subdirectory name under log_dir (default: "logs")
    
    Returns:
        FileLogger instance that should be used as a context manager or call start()/stop()
    
    Example:
        # As context manager (recommended)
        with setup_file_logging() as logger:
            print("This will be logged to file")
        
        # Manual control
        logger = setup_file_logging()
        logger.start()
        print("This will be logged")
        logger.stop()
    """
    if log_dir is None:
        log_dir = Path("core/models/ai_detection") / subdirectory
    else:
        log_dir = Path(log_dir) / subdirectory
    
    if log_filename is None:
        # Use only date (not time) for day-wise log files
        date_str = datetime.now().strftime('%Y%m%d')
        log_filename = f"training_log_{date_str}.txt"
    
    logger = FileLogger(log_dir, log_filename)
    
    # Register cleanup on exit
    atexit.register(logger.stop)
    
    return logger


@contextmanager
def file_logging(
    log_dir: Optional[Path] = None,
    log_filename: Optional[str] = None,
    subdirectory: str = "logs"
):
    """
    Context manager for file logging (convenience wrapper).
    
    Args:
        log_dir: Base directory for logs. If None, uses "core/models/ai_detection/logs"
        log_filename: Name of log file. If None, generates timestamped filename
        subdirectory: Subdirectory name under log_dir (default: "logs")
    
    Example:
        with file_logging():
            print("This will be logged to file")
    """
    logger = setup_file_logging(log_dir, log_filename, subdirectory)
    try:
        logger.start()
        yield logger
    finally:
        logger.stop()
        # Unregister atexit since we're handling cleanup here
        atexit.unregister(logger.stop)

