
import NXOpen
import NXOpen.UF
import os

the_session = NXOpen.Session.GetSession()
uf_session = NXOpen.UF.UFSession.GetUFSession()
part_path = r"C:\Users\Projecta0003\Desktop\genio-ai-next\.claude\worktrees\competent-heyrovsky-3a3c90\data\cad-reports\cad_1778066168313_i6bm5b\input\6652500650_01-BRAKE_HOUSING_-_305_4__MG_DF236_DF130_G_stp.prt"
output_obj = r"C:\Users\Projecta0003\Desktop\genio-ai-next\.claude\worktrees\competent-heyrovsky-3a3c90\data\cad-reports\cad_1778066168313_i6bm5b\input\6652500650_01-BRAKE_HOUSING_-_305_4__MG_DF236_DF130_G_stp.nx-export.obj"

base_part, load_status = the_session.Parts.OpenBaseDisplay(part_path)
if load_status:
    load_status.Dispose()
the_session.Parts.SetDisplay(base_part, False, False, NXOpen.PartDisplayPartWorkPartOption.SameAsDisplay)
the_session.Parts.SetWork(base_part)

uf_session.Part.ExportWithOptions(
    part_path,
    output_obj,
    "OBJ",
    ""
)
