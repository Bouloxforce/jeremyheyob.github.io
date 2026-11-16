import importlib.util, unittest
from pathlib import Path
from unittest.mock import patch
SPEC=importlib.util.spec_from_file_location("sync",Path("espace-visite/scripts/sync_client_to_visite.py"))
M=importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(M)
class SyncTests(unittest.TestCase):
 def test_template_example_values_are_cleared(self):
  d=M.blank_template({"slug":"x","nom":"Example","prix":123,"surface":55,"dpe":{"energie":"D","ges":"D"},"points_forts":["x"],"photos_count":9,"video":"url","annonce":"url"},"new")
  self.assertEqual(d["nom"],""); self.assertIsNone(d["prix"]); self.assertEqual(d["dpe"],{"energie":"","ges":""}); self.assertEqual(d["photos_count"],0); self.assertEqual(d["points_forts"],[])
 def test_pdf_extracts_unambiguous_surface_and_year(self):
  from unittest.mock import patch
  with patch.object(M,"fitz",None): pass
  import tempfile
  from pathlib import Path
  with tempfile.TemporaryDirectory() as td:
   folder=Path(td); (folder/"documents").mkdir()
   with patch.object(M,"fitz") as fitz:
    doc=fitz.open.return_value.__enter__.return_value
    doc.__iter__.return_value=[type("P",(),{"get_text":lambda self,_:"Surface habitable : 62,5 m²\nAnnée de construction : 1982"})()]
    self.assertEqual(M.pdf_values(folder),{"surface":62.5,"annee":1982})
if __name__=="__main__": unittest.main()
