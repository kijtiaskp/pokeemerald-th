# Brief: แปล batch ข้อความทั่วไป

โปรเจกต์: `/Users/kijtisakp/Documents/dev/owner/pokeemerald-th` (Pokémon Emerald ภาษาไทย จาก pret/pokeemerald)

## ขั้นตอน
1. อ่าน `tools/docs/translation-guide.md` ให้ครบ (กฎ token, `$`, `\p`, byte limit, น้ำเสียงตัวละคร)
2. อ่าน glossary ของ batch: `tools/data/work/<batch>.glossary.tsv` (en, th, kind, note/voice) ชื่อเฉพาะทุกคำต้องตรงตามนี้
3. อ่าน input `tools/data/work/<batch>.jsonl` ทั้งไฟล์ก่อนเริ่ม เพื่อจับเรื่องราว/ตัวละครในแต่ละ map
4. แปลทีละช่วง (~60-100 รายการ) แล้ว append ลง `tools/data/translations/<batch>.jsonl` บรรทัดละ `{"id": "...", "th": "..."}` ครบทุก id ใน input
   - เขียนผ่าน script (เช่น node/python สร้าง JSON จาก list ที่คุณแต่ง) เพื่อให้ escape ถูกต้อง: ใน JSON ต้องเป็น `\\n` `\\p` `\\l` `\\"` เหมือน `en`
5. ตรวจ: `cd tools && node --disable-warning=ExperimentalWarning src/validate.ts data/translations/<batch>.jsonl` แก้จน 0 errors (warning `manual \n` ใน dialog ให้ลบ `\n`/`\l` ออกแล้วใช้ช่องว่าง)
6. ตรวจความครบ: จำนวนบรรทัด output = input และทุก id ตรงกัน

## แนวทางคุณภาพ
- เขียนเป็นบทพูดภาษาไทยที่คนเขียน ไม่ใช่แปลคำต่อคำ รักษามุก คำสแลง อารมณ์ ความตื่นเต้น
- ผู้พูด: ดู `speakers` (gfx/gender/trainer), prefix `NAME:` ใน `en`, ชื่อ label ใน `id`, `usage`, map และบทรอบข้าง ถ้าไม่ชัดให้เดาจากเนื้อหาอย่างสมเหตุสมผล
- `trainer` intro/defeat text: พูดตาม class (เด็กขาสั้นห้าว ๆ, สาวมินิสเกิร์ตหวาน ๆ, นักปีนเขาแก่ ๆ ใจดี ฯลฯ) และเพศ (`gender` F = หญิง)
- คู่แฝด/คู่รัก (TWINS, YOUNG COUPLE, SIS AND BRO) พูดพร้อมกันใช้ `เรา`
- ป้าย (`role: sign`) และข้อความบรรยาย/ระบบ: ภาษาเขียนกลาง ไม่มีคำลงท้าย
- ผู้เล่นไม่มีเพศตายตัว ห้ามใช้คำที่ระบุเพศผู้เล่น
- `kind` = `easy_chat`: คำเดี่ยว/วลีสั้นมาก (≤ 11 byte) เป็นคำที่ผู้เล่นใช้ประกอบประโยค เช่น HELLO→สวัสดี
- `kind` = `credits`: ชื่อทีมงานคงอักษรละตินตามต้นฉบับ แปลเฉพาะตำแหน่ง/หัวข้อ
- `kind` = `ui`: สั้น กระชับ คงโครง `\n` และ token จัดวาง (`{CLEAR_TO n}` ฯลฯ) ตามต้นฉบับ

## รายงานสุดท้าย (สั้น)
จำนวนที่แปล, ผล validate, จุดที่ไม่แน่ใจ (id + เหตุผล) ไม่เกิน 15 บรรทัด
