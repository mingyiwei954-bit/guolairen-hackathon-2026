"""Deterministic fixture-only popularity and threaded replies; no visitor edits."""
import hashlib
from public_identity import STAGES

BASE = [22000,12000,8800,5200,2200,1200,680,320,96]
GENERAL = ['不同阶段看这件事，答案确实不一样。','把期待放小一点，反而更容易开始。','有时候先听完，比马上给建议更重要。','我更在意的是能不能按自己的节奏来。','这句话读起来很轻，实际做到并不容易。','不一定要一次解决全部问题。','给自己留点余地，也给别人一点时间。','想听听另一种选择会是什么样。']
POOLS = {
 '朋友':['能记得随口说过的小事，真的很难得。','关系不一定靠每天聊天来维持。','偶尔约着散步，比赶着聚餐轻松。','有分歧也能好好说话，才让人安心。','见面次数变少了，关心也可以留下。','不勉强彼此，反而更想继续联系。','愿意听你讲琐事的人很珍贵。','先主动问一句近况也不错。'],
 '工作':['能学到东西和能好好生活，都值得考虑。','下班后留一点自己的时间很重要。','第一份工作不一定就是最后的方向。','把具体问题讲清楚，比硬撑有用。','遇到愿意解释的同事会安心很多。','慢慢熟悉环境，也是一种进步。','有些合作需要先把分工说清楚。','不把一次结果看成全部评价，会轻松一点。'],
 '快乐':['不带目标地出门走走，听起来就很舒服。','不用连休息都安排得很高效。','能发现一件小小的好事，也算收获。','普通的一天也值得认真过。','吃点喜欢的东西，先照顾好自己。','允许情绪有起伏，这点很重要。','给周末留白这个想法很喜欢。','快乐不一定要是特别大的事情。'],
 '考试':['一次结果说明不了全部。','把没懂的地方弄明白，可能比排名更重要。','紧张的时候先把下一步写下来。','有人愿意听你说压力，会好一点。','准备充分也难免紧张，挺正常的。','别因为一次失误就否定以前的努力。','留一点休息时间，才能继续往前。','考完以后也想听听大家怎么放松。'],
 '家':['有人愿意听你说话，就会多一点归属感。','熟悉的饭菜和声音很能让人安心。','能自在待着，不用一直解释自己，很珍贵。','住久了，身边的小店也会变亲切。','忙的时候也可以留一句简单的问候。','一起做件小事，比讲大道理自然。','有些牵挂藏在很平常的细节里。','关系里的舒适感需要慢慢积累。'],
}
TAILS=['这一点值得记下来。','也想听听其他阶段的人怎么看。','读到这里很有共鸣。','可以从一件小事开始试试。','不着急有统一的答案。']

def seed(db):
 if db.execute("SELECT 1 FROM metadata WHERE key='mock_popularity_v1'").fetchone():return
 questions=db.execute('SELECT id,title FROM questions WHERE sample=1 ORDER BY id').fetchall()
 for rank,q in enumerate(questions):
  answers=db.execute('SELECT id FROM answers WHERE question_id=? AND sample=1 AND owner IS NULL ORDER BY base_votes DESC,id',(q['id'],)).fetchall()
  base=BASE[rank%len(BASE)]
  pool=next((text for word,text in POOLS.items() if word in q['title']),GENERAL)
  for position,a in enumerate(answers):
   votes=max(1,base-int(base*.11)*position)
   db.execute('UPDATE answers SET base_votes=? WHERE id=?',(votes,a['id']))
   count=34+(a['id']%7) if votes>=10000 else (6+a['id']%7 if votes>=1200 else 0)
   for j in range(count):
    persona=(j+a['id'])%48;stage=STAGES[persona//8];owner=f'mock-reader:{persona}'
    db.execute('INSERT OR IGNORE INTO sessions(id,stage,created) VALUES(?,?,?)',(owner,stage,1600000000))
    text=pool[j%len(pool)]+TAILS[j//len(pool)%len(TAILS)]
    db.execute('INSERT OR IGNORE INTO answer_replies(answer_id,owner,body,stage,created,client_id) VALUES(?,?,?,?,?,?)',
      (a['id'],owner,text,stage,1600000000+j,f'mock-heat-v1:{a["id"]}:{j}'))
 db.execute("INSERT INTO metadata(key,value) VALUES('mock_popularity_v1','1')")
