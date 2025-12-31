import matplotlib.pyplot as plt
from pathlib import Path
from datetime import datetime

OUTPUT_DIR = Path("core/plots")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def plot_history(history):

    timestamp = datetime.now().strftime("%m%d%Y-%H%M%S")
    # loss plot
    plt.figure(figsize=(10,6))
    plt.plot(history.history['loss'], label="Training Loss", color="Blue")
    plt.plot(history.history['val_loss'], label="Validation Loss", color="Red")
    plt.title("Loss Plot - Training and Validation Loss")
    plt.xlabel("Epochs")
    plt.ylabel("Loss - Binary Crossentropy")
    plt.legend()
    plt.grid(True)
    plt.savefig(OUTPUT_DIR / f'loss_plot_{timestamp}.png')
    plt.close()

    # metric plots
    plt.figure(figsize=(14,6))

   # accuracy subplot
    plt.subplot(1, 2, 1)
    plt.plot(history.history['accuracy'], label="Training Accuracy", color="Blue")
    plt.plot(history.history['val_accuracy'], label="Validation Accuracy", color="Red")
    plt.title('Training and Validation Accuracy')
    plt.xlabel('Epoch')
    plt.ylabel('Accuracy')
    plt.legend()
    plt.grid(True)

    # auc subplot
    plt.subplot(1, 2, 2)
    plt.plot(history.history['auc'], label='Training AUC', color='blue')
    plt.plot(history.history['val_auc'], label='Validation AUC', color='red')
    plt.title('Training and Validation AUC')
    plt.xlabel('Epoch')
    plt.ylabel('AUC')
    plt.legend()
    plt.grid(True)
    plt.tight_layout()

    plt.savefig(OUTPUT_DIR / f'metric_plots_{timestamp}.png')
    plt.close()

    # auc only plot
    plt.figure(figsize=(10, 6))
    plt.plot(history.history['auc'], label="Training AUC", linewidth=2)
    plt.plot(history.history['val_auc'], label="Validation AUC", linewidth=2)
    plt.title("AUC vs Epochs")
    plt.xlabel("Epoch")
    plt.ylabel("AUC Score")
    plt.legend()
    plt.grid(True)

    plt.savefig(OUTPUT_DIR / f'auc_plot_{timestamp}.png')
    plt.close()


def plot_multihead_history(history_dict, phase_name="multihead"):
    timestamp = datetime.now().strftime("%m%d%Y-%H%M%S")
    
    plt.figure(figsize=(12, 6))
    plt.plot(history_dict['train_total_loss'], label="Training Total Loss", color="Blue", linewidth=2)
    if 'val_total_loss' in history_dict and len(history_dict['val_total_loss']) > 0:
        plt.plot(history_dict['val_total_loss'], label="Validation Total Loss", color="Red", linewidth=2)
    plt.title(f"Total Loss - {phase_name.upper()}")
    plt.xlabel("Epochs")
    plt.ylabel("Total Loss")
    plt.legend()
    plt.grid(True, alpha=0.3)
    plt.savefig(OUTPUT_DIR / f'total_loss_{phase_name}_{timestamp}.png', dpi=150, bbox_inches='tight')
    plt.close()
    
    # Individual loss components plot
    plt.figure(figsize=(14, 10))
    
    # Subplot 1: Classification Loss
    plt.subplot(2, 2, 1)
    plt.plot(history_dict['train_class_loss'], label="Train Class Loss", color="Blue", linewidth=2)
    if 'val_class_loss' in history_dict and len(history_dict['val_class_loss']) > 0:
        plt.plot(history_dict['val_class_loss'], label="Val Class Loss", color="Red", linewidth=2)
    plt.title('Classification Loss')
    plt.xlabel('Epoch')
    plt.ylabel('Loss')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # Subplot 2: BCE Mask Loss
    plt.subplot(2, 2, 2)
    plt.plot(history_dict['train_bce_mask_loss'], label="Train BCE Mask Loss", color="Green", linewidth=2)
    if 'val_bce_mask_loss' in history_dict and len(history_dict['val_bce_mask_loss']) > 0:
        plt.plot(history_dict['val_bce_mask_loss'], label="Val BCE Mask Loss", color="Orange", linewidth=2)
    plt.title('BCE Mask Loss')
    plt.xlabel('Epoch')
    plt.ylabel('Loss')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # Subplot 3: Dice Loss
    plt.subplot(2, 2, 3)
    plt.plot(history_dict['train_dice_loss'], label="Train Dice Loss", color="Purple", linewidth=2)
    if 'val_dice_loss' in history_dict and len(history_dict['val_dice_loss']) > 0:
        plt.plot(history_dict['val_dice_loss'], label="Val Dice Loss", color="Brown", linewidth=2)
    plt.title('Dice Loss')
    plt.xlabel('Epoch')
    plt.ylabel('Loss')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    # Subplot 4: All losses combined
    plt.subplot(2, 2, 4)
    plt.plot(history_dict['train_class_loss'], label="Train Class", color="Blue", alpha=0.7, linewidth=1.5)
    plt.plot(history_dict['train_bce_mask_loss'], label="Train BCE Mask", color="Green", alpha=0.7, linewidth=1.5)
    plt.plot(history_dict['train_dice_loss'], label="Train Dice", color="Purple", alpha=0.7, linewidth=1.5)
    plt.title('All Training Losses')
    plt.xlabel('Epoch')
    plt.ylabel('Loss')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / f'loss_components_{phase_name}_{timestamp}.png', dpi=150, bbox_inches='tight')
    plt.close()
    
    # Combined overview plot
    plt.figure(figsize=(16, 6))
    
    plt.subplot(1, 3, 1)
    plt.plot(history_dict['train_total_loss'], label="Total", color="Black", linewidth=2.5)
    plt.plot(history_dict['train_class_loss'], label="Class", color="Blue", linewidth=1.5, alpha=0.8)
    plt.plot(history_dict['train_bce_mask_loss'], label="BCE Mask", color="Green", linewidth=1.5, alpha=0.8)
    plt.plot(history_dict['train_dice_loss'], label="Dice", color="Purple", linewidth=1.5, alpha=0.8)
    plt.title(f'Training Losses - {phase_name.upper()}')
    plt.xlabel('Epoch')
    plt.ylabel('Loss')
    plt.legend()
    plt.grid(True, alpha=0.3)
    
    if 'val_total_loss' in history_dict and len(history_dict['val_total_loss']) > 0:
        plt.subplot(1, 3, 2)
        plt.plot(history_dict['val_total_loss'], label="Total", color="Black", linewidth=2.5)
        plt.plot(history_dict['val_class_loss'], label="Class", color="Blue", linewidth=1.5, alpha=0.8)
        plt.plot(history_dict['val_bce_mask_loss'], label="BCE Mask", color="Green", linewidth=1.5, alpha=0.8)
        plt.plot(history_dict['val_dice_loss'], label="Dice", color="Purple", linewidth=1.5, alpha=0.8)
        plt.title(f'Validation Losses - {phase_name.upper()}')
        plt.xlabel('Epoch')
        plt.ylabel('Loss')
        plt.legend()
        plt.grid(True, alpha=0.3)
        
        plt.subplot(1, 3, 3)
        plt.plot(history_dict['train_total_loss'], label="Train Total", color="Blue", linewidth=2)
        plt.plot(history_dict['val_total_loss'], label="Val Total", color="Red", linewidth=2)
        plt.title(f'Total Loss Comparison - {phase_name.upper()}')
        plt.xlabel('Epoch')
        plt.ylabel('Loss')
        plt.legend()
        plt.grid(True, alpha=0.3)
    
    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / f'overview_{phase_name}_{timestamp}.png', dpi=150, bbox_inches='tight')
    plt.close()
    
    print(f"Multihead training plots saved to {OUTPUT_DIR}")
    print(f"  - total_loss_{phase_name}_{timestamp}.png")
    print(f"  - loss_components_{phase_name}_{timestamp}.png")
    print(f"  - overview_{phase_name}_{timestamp}.png")
