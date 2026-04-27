using System;
using System.Collections;
using System.IO;
using System.Runtime.Remoting;
using System.Runtime.Remoting.Channels;
using System.Runtime.Remoting.Channels.Http;
using System.Runtime.Remoting.Lifetime;
using System.Runtime.Serialization.Formatters;
using System.Threading;
using NXOpen;
using NXOpen.UF;

public class NxRemotingServer
{
    public static int Port = 4567;
    public static Session TheSession;
    public static UFSession TheUFSession;
    public static bool IsUnloaded;
    public static bool ServiceEnded;
    private static string _logPath;
    private static readonly object SyncLock = new object();

    public static void Main(string[] args)
    {
        _logPath = Path.Combine(Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location) ?? ".", "nx-remoting-server.log");
        Log("Starting NxRemotingServer");
        TheSession = Session.GetSession();
        TheUFSession = UFSession.GetUFSession();
        var thread = new Thread(Run);
        thread.Start();
    }

    private static void Run()
    {
        try
        {
            LifetimeServices.LeaseTime = TimeSpan.FromDays(3650);
            var provider = new SoapServerFormatterSinkProvider
            {
                TypeFilterLevel = TypeFilterLevel.Full
            };

            IDictionary props = new Hashtable();
            props["port"] = Port;
            ChannelServices.RegisterChannel(new HttpChannel(props, null, provider), false);
            RemotingServices.Marshal(TheSession, "NXOpenSession");
            RemotingServices.Marshal(TheUFSession, "UFSession");
            Log("Session exported on port " + Port);
        }
        catch (Exception ex)
        {
            Log("Run exception: " + ex);
        }

        while (!IsUnloaded)
        {
            Thread.Sleep(1000);
        }

        ServiceEnded = true;
        Log("Service ended");
    }

    public static int GetUnloadOption(string arg)
    {
        return (int)Session.LibraryUnloadOption.Explicitly;
    }

    public static void UnloadLibrary(string arg)
    {
        IsUnloaded = true;
        while (!ServiceEnded)
        {
            Thread.Sleep(100);
        }

        try
        {
            RemotingServices.Disconnect(TheSession);
            RemotingServices.Disconnect(TheUFSession);
        }
        catch (Exception ex)
        {
            Log("Unload exception: " + ex);
        }
    }

    private static void Log(string message)
    {
        lock (SyncLock)
        {
            File.AppendAllText(_logPath, $"[{DateTime.Now:O}] {message}{Environment.NewLine}");
        }
    }
}
