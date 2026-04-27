using System;
using NXOpen;
using NXOpen.UF;

public class NxRemotingClient
{
    public static int Main(string[] args)
    {
        try
        {
            var session = (Session)Activator.GetObject(typeof(Session), "http://localhost:4567/NXOpenSession");
            var ufSession = (UFSession)Activator.GetObject(typeof(UFSession), "http://localhost:4567/UFSession");

            var outputPath = args.Length > 0 ? args[0] : "C:\\Users\\Projecta0003\\Downloads\\nx-output\\Remoting.prt";
            var markId = session.SetUndoMark(Session.MarkVisibility.Visible, "NxRemotingCreate");
            var fileNew = session.Parts.FileNew();
            fileNew.TemplateFileName = "model-plain-1-mm-template.prt";
            fileNew.UseBlankTemplate = false;
            fileNew.ApplicationName = "ModelTemplate";
            fileNew.Units = Part.Units.Millimeters;
            fileNew.RelationType = "";
            fileNew.UsesMasterModel = "No";
            fileNew.TemplateType = FileNewTemplateType.Item;
            fileNew.TemplatePresentationName = "Model";
            fileNew.ItemType = "";
            fileNew.Specialization = "";
            fileNew.SetCanCreateAltrep(false);
            fileNew.NewFileName = outputPath;
            fileNew.MasterFileName = "";
            fileNew.MakeDisplayedPart = true;
            fileNew.Commit();
            var workPart = session.Parts.Work;
            fileNew.Destroy();

            session.ApplicationSwitchImmediate("UG_APP_GATEWAY");
            session.ApplicationSwitchImmediate("UG_APP_MODELING");

            var p1 = new Point3d(0.0, 0.0, 0.0);
            var p2 = new Point3d(60.0, 0.0, 0.0);
            var p3 = new Point3d(60.0, 40.0, 0.0);
            workPart.Curves.CreateLine(p1, p2);
            workPart.Curves.CreateLine(p2, p3);

            ufSession.Part.Save();
            session.SetUndoMarkName(markId, "NxRemotingCreateDone");
            Console.WriteLine("NX_REMOTING_OK");
            Console.WriteLine(outputPath);
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine(ex);
            return 1;
        }
    }
}
