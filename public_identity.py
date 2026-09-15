"""Stable public display identities; never expose session IDs or infer real identities."""
import hashlib
NAMES = (
 '在逃小馄饨','半糖乌龙','橘子汽水','今天也有风','发呆的小熊','月亮营业中','云朵观察员','一颗脆桃',
 '周末不加班','慢热河豚','芝士别跑','小狗先睡了','雨天收信人','晚风便利店','山间有回声','没熟的番茄',
 '正在加载春天','薄荷不熬夜','日落收藏家','一碗小米粥','椰子有点忙','路过的海盐','快乐小土豆','落日放映员',
 '面包会有的','风吹麦浪','山海慢慢走','小满不着急','偶尔掉线','认真摸鱼中','柠檬有点甜','听雨的阿禾',
 '草莓暂停键','一只纸飞机','云边散步','芋泥啵一下','日常捡星星','春天回电了','好梦收纳员','小岛来信',
 '茶要慢慢喝','树下等风来','猫在窗边','晚饭吃什么','一朵小浪花','有空看月亮','风筝不迷路','人间散步员'
)
STAGES=('primary','middle','secondary','college','working','retired')
def public_identity(owner=None, *, kind='answer', item_id=0, stage=None):
    if owner:
        digest=hashlib.sha256(('guolairen-display-v1:'+owner).encode()).hexdigest()
        n=int(digest[:8],16)
        name=NAMES[n%len(NAMES)]
        key='person-'+digest[:16]
    else:
        group=STAGES.index(stage) if stage in STAGES else 0
        n=group*8+(int(item_id)+(3 if kind=='question' else 0))%8
        name=NAMES[n];key='character-'+str(n)
    if owner and owner.startswith('mock-reader:'):
        n=int(owner.split(':')[1])%len(NAMES);name=NAMES[n];key='mock-person-'+str(n)
    result = {'id':key,'name':name,'avatar':'/assets/avatars/{:02d}.svg'.format(n%24)}
    if owner and owner.startswith('demo-role:'):
        result.update(simulated=True, age=int(owner.split(':')[2]))
    return result

def with_author(record,kind='answer'):
    owner=record.pop('owner',None)
    record['author']=public_identity(owner,kind=kind,item_id=record['id'],stage=record.get('stage'))
    return record
