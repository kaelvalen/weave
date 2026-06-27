# WASM ve Harici Python Pluginlerinin Tam Desteklenmesi

**Tarih:** 2026-06-27  
**Durum:** Tasarım onaylandı, uygulama planı bekleniyor  
**İlgili Dosyalar:** `src-tauri/src/runtime/python.rs`, `src-tauri/src/runtime/wasm.rs`, `src-tauri/src/core/plugin_manager.rs`, `src-tauri/src/models/manifest.rs`, `src-tauri/Cargo.toml`

---

## 1. Özet

Weave’in plugin mimarisi halihazırda `builtin`, `wasm`, `python` ve `nodejs` olmak üzere dört runtime tipini tanımlasa da gerçekte sadece built-in Rust pluginler tam olarak çalışmaktadır. Python runtime son değişikliklerle `subprocess` üzerinden çalışmaya başlamıştır, WASM runtime ise `wasmtime` feature’ının arkasında stub olarak kalmıştır.

Bu tasarım;

- WASM pluginlerin çalıştırılmasını,
- Python pluginlerin gömülü CPython (PyO3) + sanal ortam (`venv`) ile çalıştırılmasını,
- Manifest içindeki `capabilities.schemas` ve `capabilities.descriptions` alanlarının UI’ya yansıtılmasını,
- `.wpk` dağıtım formatının her iki runtime için de çıkartılarak kullanılmasını,
- Hata durumlarının `PluginState::Error` ile raporlanmasını

sağlayacak şekilde backend’i tamamlamayı amaçlar.

---

## 2. Kapsam ve Kapsam Dışı

### 2.1 Kapsam İçi

- `wasm` runtime: `wasmtime` + WASI preview 1 ile modül yükleme ve capability yürütme.
- `python` runtime: PyO3 ile gömülü CPython, plugin başına `venv` oluşturma, `requirements.txt` yüklemesi.
- `.wpk` dosyalarının her iki runtime için de geçici dizine çıkartılması.
- Manifest yetenek şema ve açıklama bilgilerinin parse edilmesi.
- Runtime hatalarının frontend’a state olarak yansıtılması.
- Yeni `WeaveError` varyantları ve test fixture’ları.

### 2.2 Kapsam Dışı

- `nodejs` runtime implementasyonu.
- Chat akışında `<call>` taglerinin parse edilip otomatik plugin çağrısına dönüştürülmesi.
- İşletim sistemi seviyesinde sandbox (seccomp, gVisor, vb.).
- Plugin market / mağaza entegrasyonu.

---

## 3. Mevcut Durum

| Runtime | Durum | Notlar |
|---|---|---|
| `builtin` | ✅ Çalışıyor | 10 adet Rust plugin `PluginManager`’da kayıtlı |
| `python` | ⚠️ Yarım | `subprocess` ile sistem `python3` çağrılıyor; bağımlılık yönetimi yok |
| `wasm` | ❌ Stub | `wasmtime` engine oluşturuluyor; `load_module`/`execute_function` boş |
| `nodejs` | ❌ Yok | Enum’da tanımlı ama kod yok |

Önemli dosyalar:

- `src-tauri/src/core/plugin_manager.rs`: Merkezi kayıt ve dispatch.
- `src-tauri/src/runtime/python.rs`: Subprocess tabanlı Python yürütücü.
- `src-tauri/src/runtime/wasm.rs`: Stub WASM yürütücü.
- `src-tauri/src/models/manifest.rs`: TOML manifest parse; `capabilities.schemas` ve `descriptions` aktarılmıyor.
- `external_plugins/math_genius/`: Örnek Python plugin, `requirements.txt` var ama hiç yüklenmiyor.

---

## 4. Tasarım

### 4.1 Genel Mimari

```text
┌─────────────────────────────────────┐
│            Frontend (React)         │
│   PluginMarket / PluginCard / hooks │
└──────────────┬──────────────────────┘
               │ Tauri IPC
┌──────────────▼──────────────────────┐
│      src-tauri/src/commands/plugin.rs│
│   plugin_discover / plugin_load     │
│   plugin_execute / plugin_unload    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      core::PluginManager            │
│  - built-in register                │
│  - external discover                │
│  - .wpk extraction                  │
│  - runtime dispatch                 │
└───────┬─────────────────┬───────────┘
        │                 │
┌───────▼──────┐  ┌───────▼──────┐
│ PythonRuntime│  │ WasmRuntime  │
│   (PyO3)     │  │  (wasmtime)  │
└──────────────┘  └──────────────┘
```

### 4.2 Cargo Yapılandırması

`src-tauri/Cargo.toml`:

```toml
[features]
default = ["wasm-runtime"]
wasm-runtime = ["wasmtime", "wasmtime-wasi"]

[dependencies]
pyo3 = { version = "0.22", features = ["auto-initialize"] }
wasmtime = { version = "22", optional = true }
wasmtime-wasi = { version = "22", optional = true }
```

`pyo3` varsayılan olarak dahil edilir; `wasmtime` `wasm-runtime` feature’ı altında kalır ve varsayılan olarak açık olur.

### 4.3 Python Runtime

Dosya: `src-tauri/src/runtime/python.rs`

#### Yükleme (`load`)

1. Plugin dizininde `.venv` klasörünün varlığını kontrol et.
2. Yoksa `python -m venv <plugin_dir>/.venv` komutunu PyO3 üzerinden çalıştır.
3. `requirements.txt` varsa `.venv` içindeki `pip` ile kurulum yap:
   - `python -m pip install -r requirements.txt`
   - Hata durumunda `PluginState::Error` ve `WeaveError::DependencyInstallError`.
4. Entry dosyasının varlığını doğrula.

#### Yürütme (`execute`)

1. `PyO3` ile yeni bir GIL bölgesi başlat.
2. `sys.path`’e plugin dizinini ve `.venv/lib/pythonX.Y/site-packages` yolunu ekle.
3. Globals sözlüğüne şunları yerleştir:
   - `__weave_capability__`: capability adı (`str`)
   - `__weave_params__`: params JSON string (`str`)
4. Entry dosyasını `py.run_file()` ile çalıştır.
5. `result` değişkenini JSON olarak oku.
6. `serde_json::from_str` ile `Value`’ya dönüştür.
7. Hata durumunda stderr ve traceback’i logla, `WeaveError::PythonRuntimeError` döndür.

#### Beklenen Entry Sözleşmesi

Python plugin geliştiricisi şu kalıbı kullanır:

```python
import json

capability = __weave_capability__
params = json.loads(__weave_params__)

result = {"value": params["x"] + params["y"]}

# result değişkeni JSON-serializable olmalıdır
```

Runtime `result` değişkenini okur. Gelecekte daha açık bir fonksiyon sözleşmesine geçilebilir, ancak mevcut `math_genius` örneğiyle uyumlu kalmak için bu aşamada değişken tabanlı sözleşme korunur.

### 4.4 WASM Runtime

Dosya: `src-tauri/src/runtime/wasm.rs`

#### ABI Sözleşmesi

WASM modülü aşağıdaki exportları sağlar:

```wat
(module
  (func (export "allocate") (param i32) (result i32))
  (func (export "deallocate") (param i32 i32))
  (func (export "execute") (param i32 i32) (result i32))
  (memory (export "memory") 1)
)
```

- `execute(capability_ptr, params_ptr) -> result_ptr`
- Tüm stringler JSON formatında, UTF-8, null-terminated.
- Host, `allocate` ile bellek ayırır, `deallocate` ile serbest bırakır.

#### Yükleme (`load_module`)

1. Plugin dizinindeki `.wasm` dosyasını bul (runtime config’ten veya varsayılan `plugin.wasm`).
2. `wasmtime::Engine` ile `Module` derle.
3. `WasiCtxBuilder` oluştur:
   - Preopen: plugin dizini (salt okunur)
   - Preopen: geçici dizin (okuma/yazma)
   - Stdout/stderr capture
4. `Linker` ile modülü bağla, `Store` oluştur.
5. Başarısız olursa `PluginState::Error`.

#### Yürütme (`execute_function`)

1. Capability ve params stringlerini JSON olarak hazırla.
2. Guest `allocate` fonksiyonu ile bellek ayır.
3. Linear memory’ye yaz.
4. Guest `execute` fonksiyonunu çağır.
5. Dönen pointerdan sonuç stringini oku.
6. `deallocate` ile pointer ve uzunluğu serbest bırak.
7. JSON parse et, `Value` olarak döndür.

### 4.5 Plugin Manager Değişiklikleri

Dosya: `src-tauri/src/core/plugin_manager.rs`

1. **`.wpk` çıkarma:**
   - `discover` sırasında `.wpk` dosyaları `~/.weave/plugins/.extracted/<plugin-id>/` altına çıkartılır.
   - Çıkartılan dizin üzerinden devam edilir.
2. **Dispatch:**
   - `RuntimeType::Python` → `PythonRuntime`
   - `RuntimeType::Wasm` → `WasmRuntime`
3. **State yönetimi:**
   - Yükleme veya yürütme hatası durumunda `PluginState::Error(String)` set edilir.
   - Hata mesajı frontend’daki plugin kartında gösterilir.

### 4.6 Manifest Parse Değişiklikleri

Dosya: `src-tauri/src/models/manifest.rs`

`Manifest::to_plugin()` metodu şu alanları da kopyalamalıdır:

- `self.capabilities.schemas` → `plugin.capabilities.schemas`
- `self.capabilities.descriptions` → `plugin.capabilities.descriptions`

Bu alanlar zaten `src/types/plugin.ts` ve `src-tauri/src/models/plugin.rs` içinde tanımlıdır, sadece parse aşamasında doldurulmamaktadır.

### 4.7 Hata Yönetimi

Yeni `WeaveError` varyantları:

```rust
pub enum WeaveError {
    // ... mevcut hatalar

    PythonRuntimeError {
        message: String,
        stderr: Option<String>,
    },

    DependencyInstallError {
        package: Option<String>,
        stderr: String,
    },

    WasmRuntimeError {
        message: String,
    },

    WasmAbiError {
        detail: String,
    },

    PluginLoadError {
        plugin_id: String,
        reason: String,
    },
}
```

`PluginState` zaten `Error(String)` varyantına sahiptir; bu varyant runtime hatalarında aktif olarak kullanılacaktır.

### 4.8 Frontend Etkisi

Frontend’de büyük bir değişiklik yapılmayacaktır. Mevcut `PluginCard` ve `PluginMarket` bileşenleri runtime bilgisini, capability listesini ve şemaları gösterecek şekilde hazırdır. Manifest parse düzeltmesi yapıldığında bu alanlar otomatik olarak dolar.

---

## 5. Test Stratejisi

### 5.1 Birim Testleri

- `manifest.rs`: `capabilities.schemas` ve `descriptions` parse testi.
- `error.rs`: Yeni hata varyantlarının serileştirilmesi.

### 5.2 Entegrasyon Testleri

- `runtime/python.rs`:
  - Basit toplama yapan Python plugin fixture’ı.
  - `requirements.txt` içeren plugin fixture’ı (örn. `requests` yerine hafif bir paket).
- `runtime/wasm.rs`:
  - Rust ile yazılıp `wasm32-wasi` hedefine derlenmiş örnek plugin.
  - `execute` exportu ile capability çağrısı testi.
- `core/plugin_manager.rs`:
  - `.wpk` dosyası oluşturma, çıkarma ve yükleme testi.

### 5.3 Fixture Yapısı

```
src-tauri/tests/fixtures/
├── plugins/
│   ├── math_python/
│   │   ├── manifest.toml
│   │   ├── main.py
│   │   └── requirements.txt
│   └── echo_wasm/
│       ├── manifest.toml
│       └── plugin.wasm
└── archives/
    └── math_python.wpk
```

---

## 6. Riskler ve Azaltma Yolları

| Risk | Etki | Azaltma |
|---|---|---|
| PyO3 build karmaşası (Python header, sürüm uyumsuzluğu) | Yüksek | Geliştirme ortamında Python 3.10+ zorunlu; `PYO3_PYTHON` ortam değişkeni belgelenecek |
| Binary boyutu artışı (libpython) | Orta | `pyo3` dinamik link opsiyonları değerlendirilecek; ilk aşamada statik link kabul edilebilir |
| Cross-platform venv/pip davranışı | Orta | Testler Linux/macOS/Windows’te çalıştırılacak; pip hataları ayrıntılı loglanacak |
| WASM modül ABI uyumsuzluğu | Orta | Test fixture’ı ve README güncellemesi ile belgeli ABI sabitlenir |
| Güvenlik (arbitrary code execution) | Orta-Yüksek | İlk aşamada yetenek başına izin modeli korunur; ileride OS sandbox ayrı tasarımla ele alınır |

---

## 7. Açık Konular

1. Python entry dosyası için daha açık bir fonksiyon imzasına (`def execute(capability, params): ...`) geçiş gelecekte düşünülebilir; bu tasarımda mevcut `result` değişkeni sözleşmesi korunur.
2. WASM pluginleri için `wit-bindgen` tabanlı component model geçişi ilerideki bir iterasyonda değerlendirilebilir.
3. `nodejs` runtime için ayrı bir tasarım gereklidir.

---

## 8. Sonraki Adım

Bu tasarım onaylandıktan sonra `writing-plans` becerisi kullanılarak adım adım uygulama planı oluşturulacaktır.
