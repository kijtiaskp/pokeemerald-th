# Pokémon Emerald ภาษาไทย (pokeemerald-th)

แปล Pokémon Emerald เป็นภาษาไทยทั้งเกม บนฐาน decompilation [pret/pokeemerald](https://github.com/pret/pokeemerald)
แจกเป็นไฟล์ patch เท่านั้น ต้องใช้ ROM ของตัวเอง (`Pokemon - Emerald Version (USA, Europe)`, SHA-1 `f3ae088181bf583e55daf962a92bb46f4f1d07b7`)

## ใช้งาน patch
1. เปิด [Rom Patcher JS](https://www.marcrobledo.com/RomPatcher.js/) หรือ Floating IPS
2. เลือก ROM ต้นฉบับ + `dist/pokeemerald-th.bps` แล้วบันทึกผลลัพธ์ `.gba`
3. ROM ที่ได้ต้องมี SHA-1 `1de8a54e345603b6cc9c32ecb774801cedba78eb`

## สิ่งที่แปล
- บทพูด ป้าย ข้อความระบบ การต่อสู้ ทีวี โปเกนาวี คำอธิบายโปเกเด็กซ์/ไอเท็ม/คุณสมบัติ easy chat (~16,300 ข้อความ)
- ชื่อโปเกมอน ตัวละคร และสถานที่ ใช้ชื่อญี่ปุ่นทับศัพท์ไทย (ฟุชิกิดาเนะ, ฮารุกะ, เมืองมิชิโระ)
- **คงภาษาอังกฤษ**: ชื่อท่า ชื่อธาตุ และชื่อไอเท็ม (ให้ค้นข้อมูลภาษาอังกฤษได้)
- ภาษาพูดตามเพศและนิสัยผู้พูด (ครับ/ค่ะ/นะ, ผม/ดิฉัน/ข้า ฯลฯ)

## โครงสร้าง
| path | หน้าที่ |
|---|---|
| `rom/` | pokeemerald (branch `thai`, tag `thai-engine` = engine ที่ยังเป็นข้อความอังกฤษ) |
| `tools/src/font/` | สร้างฟอนต์ไทยจาก GNU Unifont ลง glyph sheet ทั้ง 5 ฟอนต์ + width table + charmap |
| `tools/src/extract.ts` | ดึงข้อความทั้งหมด + บริบทผู้พูด → `tools/data/strings.jsonl` |
| `tools/data/translations/` | คำแปล (`{id, th}`) |
| `tools/src/validate.ts` | ตรวจ token, `$`, byte limit, ตัวอักษรที่รองรับ |
| `tools/src/insert.ts` | ตัดบรรทัดภาษาไทย (Intl.Segmenter + พจนานุกรมชื่อเฉพาะ) แล้วเขียนกลับ source จาก `thai-engine` |
| `tools/src/make-bps.ts` | สร้าง/ตรวจ BPS patch |
| `tools/qa/harness.lua` + `tools/src/qa.ts` | สั่ง mGBA (กดปุ่ม/ถ่ายภาพ/savestate) อัตโนมัติ |

การเปลี่ยนแปลงใน engine (`rom/`)
- `src/text.c`: วาดสระ/วรรณยุกต์ (zero-width) ซ้อนบน glyph ก่อนหน้าด้วยพื้นหลังโปร่งใส
- `tools/preproc`: Thai shaping ตอน build (วรรณยุกต์ยกสูงเมื่อมีสระบน, เลื่อนซ้ายบน ป ฝ ฟ ฬ, แยก ำ)
- ชื่อโปเกมอนยาว 12 byte (เก็บ byte 11-12 ใน field ที่ไม่ใช้ของ `BoxPokemon` ขนาด save เท่าเดิม)
- ชื่อธาตุ 8 byte, ชื่อของตกแต่ง 19 byte, ลำดับคำ "โปเกมอน<หมวด>" ในโปเกเด็กซ์
- `make THAI_QA=1`: เกมใหม่เริ่มที่เส้นทาง 102 พร้อมปาร์ตี้/ไอเท็มทดสอบ

## Build
```sh
# ครั้งแรก: devkit + agbcc + ฟอนต์ต้นแบบ
brew install arm-none-eabi-binutils arm-none-eabi-gcc libpng pkgconf
git clone https://github.com/pret/agbcc && (cd agbcc && ./build.sh && ./install.sh ../rom)
mkdir -p tools/vendor && curl -L https://unifoundry.com/pub/unifont/unifont-16.0.04/font-builds/unifont-16.0.04.hex.gz | gunzip > tools/vendor/unifont-16.0.04.hex

cd tools
npm run insert        # เขียนคำแปลลง rom/
npm run build:th      # insert + make → rom/pokeemerald.gba
npm run patch         # ต้องมี ../vanilla-src (git -C rom worktree add ../vanilla-src vanilla แล้ว make)
```

## ข้อจำกัดที่ทราบ
- ข้อความที่เป็นรูปภาพยังเป็นอังกฤษ: ไอคอนธาตุ, หัวข้อหน้า summary, เมนูโปเกนาวี, ปุ่มบนแป้นตั้งชื่อ, หน้า title
- แป้นตั้งชื่อยังเป็นอักษรละติน (ตั้งชื่อภาษาไทยไม่ได้)
- ชื่อที่ยาวที่สุด 3 ชื่อ (เนียวโรโทโนะ, เอเนโคโรโระ, นาโซโนะคุสะ) ถูกตัดท้ายในกล่อง HP และเมนูปาร์ตี้
- ชื่อเทรนเนอร์ทั่วไปทับศัพท์จากชื่ออังกฤษ (ไม่ทราบชื่อญี่ปุ่นต้นฉบับ)
- ส่วนสูง/น้ำหนักในโปเกเด็กซ์ยังเป็นหน่วยอิมพีเรียล (คำอธิบายใช้หน่วยเมตริก)
- โหมด A-Z ของ easy chat ยังจัดกลุ่มตามตัวอักษรอังกฤษ
- ตรวจในเกมแล้ว: ฉากเปิด, เมนูหลัก/START, ปาร์ตี้, summary, กระเป๋า, การต่อสู้ ยังไม่ได้เล่นจบทั้งเกม

## เครดิต
pret (pokeemerald, agbcc), GNU Unifont (glyph ต้นแบบ, SIL OFL / GPL font exception)
