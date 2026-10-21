// JsgbWebHelper: the CEF sub-process (renderer, GPU, utility) for the bridge's WebBrowserCef module.
//
// Unreal's EpicWebHelper.exe does this job for the engine's CEF 128, and a helper must be built against the same
// CEF as libcef.dll. EpicWebHelper's source is not in the launcher engine, so this is a small rewrite of the part the
// pages use: window.ue.<name> objects for SWebBrowser::BindUObject. The messages match WebBrowser's CEFJSScripting:
//   browser -> renderer  CEF::STARTUP {browser, bindings}, UE::SetValue {name, value, permanent},
//                        UE::DeleteValue {name, id, permanent}, UE::ExecuteJSFunction [id, args, isError]
//   renderer -> browser  CEF::BROWSERCREATED, UE::ExecuteUObjectMethod [objectId, method, callbackId, args]
// A method call returns a Promise that resolves with the UFunction's return value.
// Not handled: UE::ReleaseUObject (objects bound with permanent=false stay alive) and IME focus messages.

#include <windows.h>
#include <map>
#include <random>
#include <string>

#include "include/cef_app.h"
#include "include/cef_render_process_handler.h"
#include "include/cef_v8.h"

namespace
{
std::string NewId()
{
	static std::mt19937_64 Rng{std::random_device{}()};
	char Buf[33];
	snprintf(Buf, sizeof(Buf), "%016llX%016llX", (unsigned long long)Rng(), (unsigned long long)Rng());
	return Buf;
}

struct FCallback
{
	CefRefPtr<CefV8Context> Context;
	CefRefPtr<CefV8Value> Function;  // a JS function passed as an argument
	CefRefPtr<CefV8Value> Promise;   // or the promise a method call returned
};

std::map<std::string, FCallback> Callbacks;
std::map<int, CefRefPtr<CefDictionaryValue>> PermanentBindings;  // browser id -> {name: uobject}

CefRefPtr<CefV8Value> ToV8(CefRefPtr<CefValue> Value, int Depth = 0);
CefRefPtr<CefValue> FromV8(CefRefPtr<CefV8Value> Value, int Depth = 0);

class FMethodHandler : public CefV8Handler
{
public:
	explicit FMethodHandler(const CefString& InObjectId) : ObjectId(InObjectId) {}

	bool Execute(const CefString& Name, CefRefPtr<CefV8Value> Object, const CefV8ValueList& Arguments,
		CefRefPtr<CefV8Value>& Retval, CefString& Exception) override
	{
		CefRefPtr<CefV8Context> Context = CefV8Context::GetCurrentContext();
		CefRefPtr<CefFrame> Frame = Context ? Context->GetFrame() : nullptr;
		if (!Frame) { Exception = "No frame"; return true; }
		const std::string Id = NewId();
		CefRefPtr<CefV8Value> Promise = CefV8Value::CreatePromise();
		Callbacks[Id] = FCallback{Context, nullptr, Promise};

		CefRefPtr<CefListValue> Args = CefListValue::Create();
		for (size_t i = 0; i < Arguments.size(); ++i) { Args->SetValue(i, FromV8(Arguments[i])); }
		CefRefPtr<CefProcessMessage> Message = CefProcessMessage::Create("UE::ExecuteUObjectMethod");
		CefRefPtr<CefListValue> M = Message->GetArgumentList();
		M->SetString(0, ObjectId);
		M->SetString(1, Name);
		M->SetString(2, Id);
		M->SetList(3, Args);
		Frame->SendProcessMessage(PID_BROWSER, Message);
		Retval = Promise;
		return true;
	}

private:
	CefString ObjectId;
	IMPLEMENT_REFCOUNTING(FMethodHandler);
};

CefRefPtr<CefV8Value> ToV8(CefRefPtr<CefValue> Value, int Depth)
{
	if (!Value || Depth > 32) { return CefV8Value::CreateNull(); }
	switch (Value->GetType())
	{
	case VTYPE_BOOL: return CefV8Value::CreateBool(Value->GetBool());
	case VTYPE_INT: return CefV8Value::CreateInt(Value->GetInt());
	case VTYPE_DOUBLE: return CefV8Value::CreateDouble(Value->GetDouble());
	case VTYPE_STRING: return CefV8Value::CreateString(Value->GetString());
	case VTYPE_LIST:
	{
		CefRefPtr<CefListValue> List = Value->GetList();
		CefRefPtr<CefV8Value> Array = CefV8Value::CreateArray(static_cast<int>(List->GetSize()));
		for (size_t i = 0; i < List->GetSize(); ++i) { Array->SetValue(static_cast<int>(i), ToV8(List->GetValue(i), Depth + 1)); }
		return Array;
	}
	case VTYPE_DICTIONARY:
	{
		CefRefPtr<CefDictionaryValue> Dict = Value->GetDictionary();
		const std::string Type = Dict->GetType("$type") == VTYPE_STRING ? Dict->GetString("$type").ToString() : std::string();
		if (Type == "struct") { return ToV8(Dict->GetValue("$value"), Depth + 1); }
		CefRefPtr<CefV8Value> Object = CefV8Value::CreateObject(nullptr, nullptr);
		if (Type == "uobject")
		{
			const CefString Id = Dict->GetString("$id");
			CefRefPtr<FMethodHandler> Handler = new FMethodHandler(Id);
			Object->SetValue("$id", CefV8Value::CreateString(Id), static_cast<CefV8Value::PropertyAttribute>(V8_PROPERTY_ATTRIBUTE_READONLY | V8_PROPERTY_ATTRIBUTE_DONTENUM));
			CefRefPtr<CefListValue> Methods = Dict->GetList("$methods");
			for (size_t i = 0; Methods && i < Methods->GetSize(); ++i)
			{
				const CefString Method = Methods->GetString(i);
				Object->SetValue(Method, CefV8Value::CreateFunction(Method, Handler), V8_PROPERTY_ATTRIBUTE_READONLY);
			}
			return Object;
		}
		CefDictionaryValue::KeyList Keys;
		Dict->GetKeys(Keys);
		for (const CefString& Key : Keys) { Object->SetValue(Key, ToV8(Dict->GetValue(Key), Depth + 1), V8_PROPERTY_ATTRIBUTE_NONE); }
		return Object;
	}
	default: return CefV8Value::CreateNull();
	}
}

CefRefPtr<CefValue> FromV8(CefRefPtr<CefV8Value> Value, int Depth)
{
	CefRefPtr<CefValue> Out = CefValue::Create();
	if (!Value || Depth > 32 || Value->IsUndefined() || Value->IsNull()) { Out->SetNull(); return Out; }
	if (Value->IsBool()) { Out->SetBool(Value->GetBoolValue()); return Out; }
	if (Value->IsInt()) { Out->SetInt(Value->GetIntValue()); return Out; }
	if (Value->IsUInt() || Value->IsDouble()) { Out->SetDouble(Value->GetDoubleValue()); return Out; }
	if (Value->IsString()) { Out->SetString(Value->GetStringValue()); return Out; }
	if (Value->IsFunction())
	{
		const std::string Id = NewId();
		Callbacks[Id] = FCallback{CefV8Context::GetCurrentContext(), Value, nullptr};
		CefRefPtr<CefDictionaryValue> Dict = CefDictionaryValue::Create();
		Dict->SetString("$type", "function");
		Dict->SetString("$id", Id);
		Out->SetDictionary(Dict);
		return Out;
	}
	if (Value->IsArray())
	{
		CefRefPtr<CefListValue> List = CefListValue::Create();
		for (int i = 0; i < Value->GetArrayLength(); ++i) { List->SetValue(i, FromV8(Value->GetValue(i), Depth + 1)); }
		Out->SetList(List);
		return Out;
	}
	if (Value->IsObject())
	{
		CefRefPtr<CefDictionaryValue> Dict = CefDictionaryValue::Create();
		CefRefPtr<CefV8Value> Id = Value->HasValue("$id") ? Value->GetValue("$id") : nullptr;
		if (Id && Id->IsString())
		{
			Dict->SetString("$type", "uobject");
			Dict->SetString("$id", Id->GetStringValue());
		}
		else
		{
			std::vector<CefString> Keys;
			Value->GetKeys(Keys);
			for (const CefString& Key : Keys) { Dict->SetValue(Key, FromV8(Value->GetValue(Key), Depth + 1)); }
		}
		Out->SetDictionary(Dict);
		return Out;
	}
	Out->SetNull();
	return Out;
}

// Sets window.ue[Name] in the frame's current context (creating window.ue when needed).
void SetBinding(CefRefPtr<CefFrame> Frame, const CefString& Name, CefRefPtr<CefValue> Value)
{
	CefRefPtr<CefV8Context> Context = Frame ? Frame->GetV8Context() : nullptr;
	if (!Context || !Context->Enter()) { return; }
	CefRefPtr<CefV8Value> Window = Context->GetGlobal();
	CefRefPtr<CefV8Value> Ue = Window->GetValue("ue");
	if (!Ue || !Ue->IsObject())
	{
		Ue = CefV8Value::CreateObject(nullptr, nullptr);
		Window->SetValue("ue", Ue, V8_PROPERTY_ATTRIBUTE_NONE);
	}
	if (Value) { Ue->SetValue(Name, ToV8(Value), V8_PROPERTY_ATTRIBUTE_NONE); }
	else { Ue->DeleteValue(Name); }
	Context->Exit();
}

void ApplyPermanent(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame)
{
	auto It = PermanentBindings.find(Browser->GetIdentifier());
	if (It == PermanentBindings.end()) { return; }
	CefDictionaryValue::KeyList Keys;
	It->second->GetKeys(Keys);
	for (const CefString& Key : Keys) { SetBinding(Frame, Key, It->second->GetValue(Key)); }
}

class FHelperApp : public CefApp, public CefRenderProcessHandler
{
public:
	CefRefPtr<CefRenderProcessHandler> GetRenderProcessHandler() override { return this; }

	void OnContextCreated(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, CefRefPtr<CefV8Context> Context) override
	{
		if (!Frame->IsMain()) { return; }
		// window.ue exists from the start, as with EpicWebHelper.
		if (Context->Enter())
		{
			if (!Context->GetGlobal()->HasValue("ue")) { Context->GetGlobal()->SetValue("ue", CefV8Value::CreateObject(nullptr, nullptr), V8_PROPERTY_ATTRIBUTE_NONE); }
			Context->Exit();
		}
		ApplyPermanent(Browser, Frame);
		// The browser answers with CEF::STARTUP and the current permanent bindings.
		Frame->SendProcessMessage(PID_BROWSER, CefProcessMessage::Create("CEF::BROWSERCREATED"));
	}

	void OnContextReleased(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, CefRefPtr<CefV8Context> Context) override
	{
		for (auto It = Callbacks.begin(); It != Callbacks.end();)
		{
			if (It->second.Context && It->second.Context->IsSame(Context)) { It = Callbacks.erase(It); } else { ++It; }
		}
	}

	void OnBrowserDestroyed(CefRefPtr<CefBrowser> Browser) override { PermanentBindings.erase(Browser->GetIdentifier()); }

	bool OnProcessMessageReceived(CefRefPtr<CefBrowser> Browser, CefRefPtr<CefFrame> Frame, CefProcessId Source,
		CefRefPtr<CefProcessMessage> Message) override
	{
		const std::string Name = Message->GetName().ToString();
		CefRefPtr<CefListValue> Args = Message->GetArgumentList();
		CefRefPtr<CefFrame> Main = Browser->GetMainFrame();
		if (Name == "CEF::STARTUP")
		{
			if (Args->GetSize() > 0 && Args->GetType(0) == VTYPE_DICTIONARY)
			{
				CefRefPtr<CefDictionaryValue> Info = Args->GetDictionary(0);
				if (Info->GetType("bindings") == VTYPE_DICTIONARY)
				{
					PermanentBindings[Browser->GetIdentifier()] = Info->GetDictionary("bindings")->Copy(false);
					ApplyPermanent(Browser, Main);
				}
			}
			return true;
		}
		if (Name == "UE::SetValue" || Name == "UE::DeleteValue")
		{
			if (Args->GetSize() < 1 || Args->GetType(0) != VTYPE_DICTIONARY) { return false; }
			CefRefPtr<CefDictionaryValue> Info = Args->GetDictionary(0);
			const CefString BindingName = Info->GetString("name");
			const bool bPermanent = Info->GetBool("permanent");
			CefRefPtr<CefDictionaryValue>& Perm = PermanentBindings[Browser->GetIdentifier()];
			if (!Perm) { Perm = CefDictionaryValue::Create(); }
			if (Name == "UE::SetValue")
			{
				CefRefPtr<CefValue> Value = Info->GetValue("value");
				if (bPermanent) { Perm->SetValue(BindingName, Value->Copy()); }
				SetBinding(Main, BindingName, Value);
			}
			else
			{
				if (bPermanent) { Perm->Remove(BindingName); }
				SetBinding(Main, BindingName, nullptr);
			}
			return true;
		}
		if (Name == "UE::ExecuteJSFunction")
		{
			if (Args->GetSize() < 3) { return false; }
			const std::string Id = Args->GetString(0).ToString();
			CefRefPtr<CefListValue> CallArgs = Args->GetList(1);
			const bool bError = Args->GetBool(2);
			auto It = Callbacks.find(Id);
			if (It == Callbacks.end()) { return true; }
			FCallback Callback = It->second;
			if (Callback.Promise) { Callbacks.erase(It); }
			if (!Callback.Context || !Callback.Context->IsValid() || !Callback.Context->Enter()) { return true; }
			if (Callback.Promise)
			{
				if (bError) { Callback.Promise->RejectPromise(CallArgs && CallArgs->GetSize() > 0 && CallArgs->GetType(0) == VTYPE_STRING ? CallArgs->GetString(0) : CefString("Error")); }
				else { Callback.Promise->ResolvePromise(CallArgs && CallArgs->GetSize() > 0 ? ToV8(CallArgs->GetValue(0)) : CefV8Value::CreateUndefined()); }
			}
			else if (Callback.Function)
			{
				CefV8ValueList V8Args;
				for (size_t i = 0; CallArgs && i < CallArgs->GetSize(); ++i) { V8Args.push_back(ToV8(CallArgs->GetValue(i))); }
				Callback.Function->ExecuteFunction(nullptr, V8Args);
			}
			Callback.Context->Exit();
			return true;
		}
		return false;
	}

private:
	IMPLEMENT_REFCOUNTING(FHelperApp);
};
}  // namespace

int APIENTRY wWinMain(HINSTANCE Instance, HINSTANCE, LPWSTR, int)
{
	CefMainArgs Args(Instance);
	CefRefPtr<FHelperApp> App = new FHelperApp();
	return CefExecuteProcess(Args, App, nullptr);
}
