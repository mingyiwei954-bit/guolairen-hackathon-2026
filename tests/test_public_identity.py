import unittest
from public_identity import public_identity,with_author,NAMES
class PublicIdentityTests(unittest.TestCase):
 def test_stable_across_items_and_stage_changes(self):
  a=public_identity('private-session',item_id=1,stage='college')
  b=public_identity('private-session',item_id=999,stage='working',kind='question')
  self.assertEqual(a,b)
  self.assertNotIn('private-session',str(a))
  self.assertNotEqual(a['id'],public_identity('another-session')['id'])
 def test_mock_character_pool(self):
  profiles=[public_identity(item_id=i,stage=stage) for stage in ('primary','middle','secondary','college','working','retired') for i in range(8)]
  self.assertEqual(len(set(p['id'] for p in profiles)),48)
  self.assertEqual(len(set(p['name'] for p in profiles)),48)
  self.assertTrue(all(p['name'] in NAMES for p in profiles))
 def test_never_exposes_owner(self):
  row=with_author({'id':1,'stage':'college','owner':'secret','body':'text'})
  self.assertNotIn('owner',row);self.assertNotIn('secret',str(row));self.assertIn('author',row)
if __name__=='__main__':unittest.main()
