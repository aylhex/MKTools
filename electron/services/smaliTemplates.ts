export class SmaliTemplates {
  // 1. ProxyHookPMS.smali
  static readonly proxyHookPMS = `.class public Lcom/verify/signature/ProxyHookPMS;
.super Ljava/lang/Object;
.source "ProxyHookPMS.java"

# interfaces
.implements Ljava/lang/reflect/InvocationHandler;

# instance fields
.field private SIGN:Ljava/lang/String;
.field private appPkgName:Ljava/lang/String;
.field private base:Ljava/lang/Object;

# direct methods
.method public constructor <init>(Ljava/lang/Object;Ljava/lang/String;Ljava/lang/String;I)V
    .locals 0
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    :try_start_0
    iput-object p1, p0, Lcom/verify/signature/ProxyHookPMS;->base:Ljava/lang/Object;
    iput-object p2, p0, Lcom/verify/signature/ProxyHookPMS;->SIGN:Ljava/lang/String;
    iput-object p3, p0, Lcom/verify/signature/ProxyHookPMS;->appPkgName:Ljava/lang/String;
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0
    goto :goto_0
    :catch_0
    move-exception p1
    invoke-virtual {p1}, Ljava/lang/Exception;->printStackTrace()V
    :goto_0
    return-void
.end method

# virtual methods
.method public invoke(Ljava/lang/Object;Ljava/lang/reflect/Method;[Ljava/lang/Object;)Ljava/lang/Object;
    .locals 3
    .annotation system Ldalvik/annotation/Throws;
        value = {
            Ljava/lang/Throwable;
        }
    .end annotation

    # Log invoke
    const-string v0, "SIGN_HOOK"
    new-instance v1, Ljava/lang/StringBuilder;
    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V
    const-string v2, "ProxyHookPMS.invoke: "
    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {p2}, Ljava/lang/reflect/Method;->getName()Ljava/lang/String;
    move-result-object v2
    invoke-virtual {v1, v2}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;
    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;
    move-result-object v1
    invoke-static {v0, v1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    const-string p1, "getPackageInfo"
    invoke-virtual {p2}, Ljava/lang/reflect/Method;->getName()Ljava/lang/String;
    move-result-object v0
    invoke-virtual {p1, v0}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result p1
    if-eqz p1, :cond_0
    const/4 p1, 0x0
    aget-object v0, p3, p1
    check-cast v0, Ljava/lang/String;
    const/4 v1, 0x1
    aget-object v1, p3, v1
    check-cast v1, Ljava/lang/Integer;
    invoke-virtual {v1}, Ljava/lang/Integer;->intValue()I
    move-result v1
    const/16 v2, 0x40
    and-int/2addr v1, v2
    if-eqz v1, :cond_0
    iget-object v1, p0, Lcom/verify/signature/ProxyHookPMS;->appPkgName:Ljava/lang/String;
    invoke-virtual {v1, v0}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z
    move-result v0
    if-eqz v0, :cond_0
    new-instance v0, Landroid/content/pm/Signature;
    iget-object v1, p0, Lcom/verify/signature/ProxyHookPMS;->SIGN:Ljava/lang/String;
    invoke-direct {v0, v1}, Landroid/content/pm/Signature;-><init>(Ljava/lang/String;)V
    iget-object v1, p0, Lcom/verify/signature/ProxyHookPMS;->base:Ljava/lang/Object;
    invoke-virtual {p2, v1, p3}, Ljava/lang/reflect/Method;->invoke(Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;
    move-result-object p2
    check-cast p2, Landroid/content/pm/PackageInfo;
    iget-object p3, p2, Landroid/content/pm/PackageInfo;->signatures:[Landroid/content/pm/Signature;
    aput-object v0, p3, p1
    return-object p2
    :cond_0
    iget-object p1, p0, Lcom/verify/signature/ProxyHookPMS;->base:Ljava/lang/Object;
    invoke-virtual {p2, p1, p3}, Ljava/lang/reflect/Method;->invoke(Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;
    move-result-object p1
    return-object p1
.end method
`;

  // 2. HookServiceWraper.smali
  static readonly hookServiceWraper = `.class public Lcom/verify/signature/HookServiceWraper;
.super Ljava/lang/Object;
.source "HookServiceWraper.java"

# direct methods
.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V
    return-void
.end method

.method public static startHookPMS(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V
    .locals 8
    
    # Log start
    const-string v0, "SIGN_HOOK"
    const-string v1, "HookServiceWraper.startHookPMS called"
    invoke-static {v0, v1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    :try_start_0
    const-string v0, "android.app.ActivityThread"
    invoke-static {v0}, Ljava/lang/Class;->forName(Ljava/lang/String;)Ljava/lang/Class;
    move-result-object v0
    const-string v1, "currentActivityThread"
    const/4 v2, 0x0
    new-array v3, v2, [Ljava/lang/Class;
    invoke-virtual {v0, v1, v3}, Ljava/lang/Class;->getDeclaredMethod(Ljava/lang/String;[Ljava/lang/Class;)Ljava/lang/reflect/Method;
    move-result-object v1
    new-array v3, v2, [Ljava/lang/Object;
    const/4 v4, 0x0
    invoke-virtual {v1, v4, v3}, Ljava/lang/reflect/Method;->invoke(Ljava/lang/Object;[Ljava/lang/Object;)Ljava/lang/Object;
    move-result-object v1
    const-string v3, "sPackageManager"
    invoke-virtual {v0, v3}, Ljava/lang/Class;->getDeclaredField(Ljava/lang/String;)Ljava/lang/reflect/Field;
    move-result-object v0
    const/4 v3, 0x1
    invoke-virtual {v0, v3}, Ljava/lang/reflect/Field;->setAccessible(Z)V
    invoke-virtual {v0, v1}, Ljava/lang/reflect/Field;->get(Ljava/lang/Object;)Ljava/lang/Object;
    move-result-object v4
    const-string v5, "android.content.pm.IPackageManager"
    invoke-static {v5}, Ljava/lang/Class;->forName(Ljava/lang/String;)Ljava/lang/Class;
    move-result-object v5
    invoke-virtual {v5}, Ljava/lang/Class;->getClassLoader()Ljava/lang/ClassLoader;
    move-result-object v6
    new-array v7, v3, [Ljava/lang/Class;
    aput-object v5, v7, v2
    new-instance v5, Lcom/verify/signature/ProxyHookPMS;
    invoke-direct {v5, v4, p1, p2, v2}, Lcom/verify/signature/ProxyHookPMS;-><init>(Ljava/lang/Object;Ljava/lang/String;Ljava/lang/String;I)V
    invoke-static {v6, v7, v5}, Ljava/lang/reflect/Proxy;->newProxyInstance(Ljava/lang/ClassLoader;[Ljava/lang/Class;Ljava/lang/reflect/InvocationHandler;)Ljava/lang/Object;
    move-result-object p1
    invoke-virtual {v0, v1, p1}, Ljava/lang/reflect/Field;->set(Ljava/lang/Object;Ljava/lang/Object;)V
    invoke-virtual {p0}, Landroid/content/Context;->getPackageManager()Landroid/content/pm/PackageManager;
    move-result-object p0
    invoke-virtual {p0}, Ljava/lang/Object;->getClass()Ljava/lang/Class;
    move-result-object p2
    const-string v0, "mPM"
    invoke-virtual {p2, v0}, Ljava/lang/Class;->getDeclaredField(Ljava/lang/String;)Ljava/lang/reflect/Field;
    move-result-object p2
    invoke-virtual {p2, v3}, Ljava/lang/reflect/Field;->setAccessible(Z)V
    invoke-virtual {p2, p0, p1}, Ljava/lang/reflect/Field;->set(Ljava/lang/Object;Ljava/lang/Object;)V
    
    # Log success
    const-string v0, "SIGN_HOOK"
    const-string v1, "HookServiceWraper: Hook installed successfully"
    invoke-static {v0, v1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I

    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0
    goto :goto_0
    :catch_0
    move-exception p0
    
    # Log error
    const-string v0, "SIGN_HOOK"
    const-string v1, "HookServiceWraper: Error installing hook"
    invoke-static {v0, v1, p0}, Landroid/util/Log;->e(Ljava/lang/String;Ljava/lang/String;Ljava/lang/Throwable;)I

    invoke-virtual {p0}, Ljava/lang/Exception;->printStackTrace()V
    :goto_0
    return-void
.end method
`;

  // 3. MyApplication.smali 模板
  static readonly myApplicationTemplate = `.class public Lcom/demo/repackage/MyApplication;
.super Landroid/app/Application;
.source "MyApplication.java"

# direct methods
.method public constructor <init>()V
    .locals 0
    invoke-direct {p0}, Landroid/app/Application;-><init>()V
    return-void
.end method

.method protected attachBaseContext(Landroid/content/Context;)V
    .locals 2
    
    const-string v0, "SIGN_HOOK"
    const-string v1, "MyApplication.attachBaseContext called"
    invoke-static {v0, v1}, Landroid/util/Log;->d(Ljava/lang/String;Ljava/lang/String;)I
    
    # 注入点
    const-string v0, "{SIGNATURE}"
    const-string v1, "{PACKAGE_NAME}"
    invoke-static {p1, v0, v1}, Lcom/verify/signature/HookServiceWraper;->startHookPMS(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V
    
    invoke-super {p0, p1}, Landroid/app/Application;->attachBaseContext(Landroid/content/Context;)V
    return-void
.end method

.method public onCreate()V
    .locals 0
    invoke-super {p0}, Landroid/app/Application;->onCreate()V
    return-void
.end method
`;
}
