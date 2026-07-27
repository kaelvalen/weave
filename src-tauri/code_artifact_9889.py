# yolov8_person_detection.py

from ultralytics import YOLO

# YOLOv8 modelini yükleme
model = YOLO('yolov8n.pt')  # 'yolov8n.pt' modeli kullanılır

# Video dosyasını okuma ve insan tespiti yapma
results = model('path/to/your/video.mp4', show=True)

# Tespit edilen nesnelerin listesi
for result in results:
    boxes = result.boxes  # YOLOv8 bounding box bilgisi
    for box in boxes:
        cls = int(box.cls[0])  # Nesne sınıfı
        conf = float(box.conf[0])  # Etiket güveni
        if cls == 0:  # İnsan sınıfı (0) ise işlem yap
            x1, y1, x2, y2 = box.xyxy[0]  # Noktalar
            print(f'Insan tespit edildi. Konum: ({x1}, {y1}), ({x2}, {y2}), Güven: {conf:.2f}')